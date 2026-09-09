#!/usr/bin/env ruby
# Build traceability artifacts with Ruby's standard YAML parser.

require "json"
require "pathname"
require "time"
require "yaml"

root = Pathname.new(ARGV.fetch(0))
strict = ARGV.fetch(1, "0") == "1"
release_path = root.join("specs", "release-plan.yaml")
status_path = root.join("specs", "execution-status.yaml")

abort "trace-stories: missing #{release_path}" unless release_path.file?
abort "trace-stories: missing #{status_path}" unless status_path.file?

def load_yaml(path)
  YAML.safe_load(File.read(path), [], [], false) || {}
end

def scalar(value, fallback = "")
  value.nil? ? fallback : value
end

release = load_yaml(release_path)
execution = load_yaml(status_path)
development_status = execution.fetch("development_status", {})
story_statuses = {}
execution.fetch("epics", {}).each do |epic_id, epic|
  epic.fetch("stories", {}).each do |story_id, story|
    story_statuses[story_id] = story["status"] if story.is_a?(Hash)
  end
end

stories = {}
release.fetch("epics", []).each do |epic|
  next unless epic.is_a?(Hash)

  capsule = epic["capsule_dir"]
  next unless capsule
  capsule_path = root.join("specs", capsule, "epic.yaml")
  next unless capsule_path.file?

  load_yaml(capsule_path).fetch("stories", []).each do |story|
    next unless story.is_a?(Hash) && story["id"]

    story_id = story["id"]
    stories[story_id] = {
      "id" => story_id,
      "title" => scalar(story["title"]),
      "epic_id" => scalar(epic["id"]),
      "epic_title" => scalar(epic["title"]),
      "bcp" => scalar(story["bcp"], 0),
      "wsjf" => scalar(epic["wsjf"], 0).to_f
    }
  end
end

excluded_parts = %w[.git node_modules .pi .bigpowers dist build]
code_extensions = %w[.md .sh .py .js .ts .jsx .tsx .yaml .yml .json .rb]
code_files = root.join(".").glob("**/*").select do |path|
  relative = path.relative_path_from(root).to_s
  path.file? && code_extensions.include?(path.extname) &&
    !relative.split(File::SEPARATOR).any? { |part| excluded_parts.include?(part) } &&
    !relative.start_with?("specs/archive/", "specs/codebase-wiki/")
end

tag_index = Hash.new { |hash, key| hash[key] = [] }
code_files.each do |path|
  path.each_line.with_index(1) do |line, number|
    line.scan(/^\s*(?:#|\/\/|--)\s*story:\s*(e\d+s\d+)/).flatten.each do |story_id|
      tag_index[story_id] << {
        "file" => path.relative_path_from(root).to_s,
        "line" => number,
        "confidence" => "high",
        "method" => "explicit_tag"
      }
    end
  end
end

task_links = Hash.new { |hash, key| hash[key] = [] }
root.join("specs", "epics").glob("**/*-tasks.yaml").each do |path|
  content = File.read(path)
  stories.keys.each do |story_id|
    next unless content.lines.any? { |line| line.match?(/^\s*story_id:\s*#{Regexp.escape(story_id)}\s*$/) }

    task_links[story_id] << {
      "file" => path.relative_path_from(root).to_s,
      "line" => 0,
      "confidence" => "low",
      "method" => "task_reference"
    }
  end
end

matrix_stories = stories.values.sort_by { |story| story["id"] }.map do |story|
  story_id = story["id"]
  links = (tag_index[story_id] + task_links[story_id]).uniq { |link| link["file"] }
  status = story_statuses[story_id] || development_status[story["epic_id"]] || "backlog"
  story.merge("status" => status, "links" => links, "link_count" => links.length)
end

dark_stories = []
matrix_stories.each do |story|
  if story["links"].empty? && !%w[backlog todo planned].include?(story["status"])
    dark_stories << story["id"]
  end
end
orphan_tags = tag_index.keys - stories.keys
stale_tags = []
matrix_stories.each do |story|
  stale_tags << story["id"] if story["status"] == "done" && tag_index.key?(story["id"])
end
oracle_stats = {
  "high" => matrix_stories.sum { |story| story["links"].count { |link| link["confidence"] == "high" } },
  "medium" => 0,
  "low" => matrix_stories.sum { |story| story["links"].count { |link| link["confidence"] == "low" } }
}

matrix = {
  "generated_at" => Time.now.utc.iso8601,
  "matrix_version" => "1.0",
  "stories" => matrix_stories,
  "summary" => {
    "total_stories" => matrix_stories.length,
    "tagged_stories" => matrix_stories.count { |story| story["links"].any? { |link| link["method"] == "explicit_tag" } },
    "dark_stories" => dark_stories,
    "dark_count" => dark_stories.length,
    "orphan_tags" => orphan_tags,
    "orphan_count" => orphan_tags.length,
    "stale_tags" => stale_tags,
    "stale_count" => stale_tags.length,
    "oracle_stats" => oracle_stats
  }
}

matrix_path = root.join("specs", "traceability-matrix.json")
matrix_path.write(JSON.pretty_generate(matrix) + "\n")

lines = [
  "# Traceability Matrix", "", "**Generated:** #{matrix["generated_at"]}",
  "**Total stories:** #{matrix_stories.length}",
  "**Dark stories:** #{dark_stories.length}", "", "## Story Coverage", "",
  "| Story | Title | Epic | Status | Links |", "|---|---|---|---|---|"
]
matrix_stories.each do |story|
  lines << "| #{story["id"]} | #{story["title"]} | #{story["epic_id"]} | #{story["status"]} | #{story["link_count"]} |"
end
root.join("specs", "TRACEABILITY_LATEST.md").write(lines.join("\n") + "\n")

if strict && dark_stories.any?
  warn "trace-stories: STRICT FAIL — stories without links: #{dark_stories.join(", ")}"
  exit 2
end
puts "trace-stories: #{matrix_stories.length} stories, #{dark_stories.length} dark"
