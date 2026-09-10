# Run from ganesh/: ruby specs/verifications/check-blueprint.rb
# Documentation gate only; does not exercise product behavior.
require 'yaml'

def check(condition, message)
  abort("FAIL: #{message}") unless condition
end

def read_yaml(path)
  YAML.safe_load(File.read(path))
end

Dir['specs/**/*.yaml'].each { |path| read_yaml(path) }
plan = read_yaml('specs/release-plan.yaml')
scope = read_yaml('specs/product/SCOPE_LATEST.yaml')
status = read_yaml('specs/execution-status.yaml')
check(plan['release'].key?('version'), 'release version label missing')
check(status['development_status'].is_a?(Hash), 'development status missing')
epics = plan.fetch('epics')
ids = epics.map { |e| e.fetch('id') }
check(!ids.empty? && ids.uniq == ids, 'missing or duplicate epic IDs')
check(!scope.fetch('out_of_scope').empty?, 'exclusions missing')
requirements = scope.fetch('in_scope')
check(requirements.map { |r| r['id'] }.uniq.length == requirements.length, 'duplicate requirement IDs')
seen = []
coverage = []
scenarios = []
epics.each_with_index do |e, i|
  check((e.fetch('depends_on') - seen).empty?, "#{e['id']} dependency ordering")
  eligible = epics.reject { |x| seen.include?(x['id']) }.select { |x| (x['depends_on'] - seen).empty? }
  best = eligible.sort_by { |x| [-x['wsjf'], x['id']] }.first
  check(best['id'] == e['id'], "#{e['id']} violates eligible WSJF ordering")
  manifest = read_yaml(File.join('specs', e.fetch('file')))
  check(e['file'] == e['capsule_dir'] + '/epic.yaml', 'capsule file mismatch')
  %w[id title wsjf depends_on scope_ids sequence].each do |key|
    check(manifest[key] == e[key], "#{e['id']} mismatched #{key}")
  end
  check(e['sequence'] == i + 1, 'sequence mismatch')
  stories = manifest.fetch('stories')
  check(!manifest.fetch('acceptance_outcomes').empty?, 'acceptance outcomes absent')
  if stories.empty?
    check(manifest['story_planning'] == 'deferred_to_bp_plan', "#{e['id']} empty story list must remain deferred")
  else
    check(manifest['story_planning'] == 'complete', "#{e['id']} planned stories must be complete")
    story_ids = stories.map { |story| story.fetch('id') }
    check(story_ids.uniq == story_ids, "#{e['id']} duplicate story IDs")
    check(stories.sum { |story| story.fetch('bcps') } == manifest.fetch('total_bcps'), "#{e['id']} story BCP total")
    stories.each_with_index do |story, story_index|
      %w[id title status bcps risk delta depends_on spec_file tasks_file].each do |key|
        check(story.key?(key), "#{story.fetch('id', e['id'])} missing #{key}")
      end
      check(story['depends_on'].all? { |dependency| story_ids[0...story_index].include?(dependency) }, "#{story['id']} story dependency ordering")
      spec_path = File.join('specs', e.fetch('capsule_dir'), story.fetch('spec_file'))
      tasks_path = File.join('specs', e.fetch('capsule_dir'), story.fetch('tasks_file'))
      check(File.file?(spec_path), "#{story['id']} story spec missing")
      check(File.file?(tasks_path), "#{story['id']} task ledger missing")
      task_ledger = read_yaml(tasks_path)
      check(task_ledger['story_id'] == story['id'], "#{story['id']} task ledger identity")
      tasks = task_ledger.fetch('tasks')
      check(!tasks.empty?, "#{story['id']} tasks missing")
      check(tasks.all? { |task| %w[failing passing].include?(task['status']) && task['verify'].is_a?(String) && !task['verify'].strip.empty? }, "#{story['id']} tasks must use failing or passing status with verify commands")
      check(File.read(spec_path).scan(/^## \d+\./).length >= 20, "#{story['id']} story spec maturity")
    end
  end
  inputs = manifest.fetch('wsjf_inputs')
  score = (inputs['business_value'] + inputs['time_criticality'] + inputs['risk_reduction'] + inputs['security_boost']).to_f / inputs['job_size']
  check((score - e['wsjf']).abs < 0.000001, 'WSJF formula mismatch')
  check(manifest['total_bcps'] == e['bcps'], 'BCP mismatch')
  coverage.concat(manifest['scope_ids'])
  scenarios.concat(manifest['acceptance_scenarios']) unless e['id'] == 'e17'
  seen << e['id']
end
check(coverage.sort == requirements.map { |r| r['id'] }.sort, 'missing or multiply owned requirement')
requirements.each do |r|
  epic = epics.find { |e| e['id'] == r['epic_id'] }
  check(epic && epic['scope_ids'].include?(r['id']), "unmapped #{r['id']}")
  manifest = read_yaml(File.join('specs', epic['file']))
  check(manifest['acceptance_outcomes'] == r['success_criteria'], "#{r['id']} acceptance drift")
end
check((1..20).all? { |n| scenarios.include?(format('AC-%02d', n)) }, 'unmapped acceptance scenario')
check(plan['estimation']['total_bcps'] == epics.sum { |e| e['bcps'] }, 'BCP sum mismatch')
check(status['development_status'].keys.sort == ids.sort, 'execution status ID mismatch')
expected_task_files = []
expected_story_specs = []
epics.each do |e|
  manifest = read_yaml(File.join('specs', e.fetch('file')))
  manifest.fetch('stories').each do |story|
    expected_task_files << File.join('specs', e.fetch('capsule_dir'), story.fetch('tasks_file'))
    expected_story_specs << File.join('specs', e.fetch('capsule_dir'), story.fetch('spec_file'))
  end
end
check(Dir['specs/epics/**/*-tasks.yaml'].sort == expected_task_files.sort, 'unexpected or missing task ledger')
check(Dir['specs/epics/**/e*s*-*.md'].sort == expected_story_specs.sort, 'unexpected or missing story spec')
check(Dir['specs/epics/**/epic.yaml'].length == ids.length, 'orphan epic manifest')
plan.fetch('blockers').each { |b| check(ids.include?(b['owner_epic']), 'unowned blocker') }
puts "PASS: #{ids.length} epics, #{requirements.length} outcomes, AC-01–20, dependency/WSJF order, BCP totals, YAML, and capsule/task status."
