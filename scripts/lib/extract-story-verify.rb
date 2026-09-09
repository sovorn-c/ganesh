#!/usr/bin/env ruby
# story: e45s04
# Emit story/task verify directives without requiring a Python package.

require "yaml"

repo_root = ARGV.fetch(0, ".")
field_separator = "\t"

flatten = ->(command) { command.to_s.split.join(" ") }

emit = lambda do |record_id, source_path, status, command|
  next if record_id.nil? || command.nil? || command.to_s.empty?

  relative_path = Pathname(source_path).relative_path_from(Pathname(repo_root)).to_s
  puts [record_id, relative_path, status || "unknown", flatten.call(command)].join(field_separator)
end

require "pathname"

Dir[File.join(repo_root, "specs", "epics", "*", "epic.yaml")].sort.each do |epic_path|
  document = YAML.safe_load(File.read(epic_path), [], [], false) || {}
  Array(document["stories"]).each do |story|
    next unless story.is_a?(Hash)

    emit.call(story["id"], epic_path, story["status"], story["verify"])
  end
end

tasks_glob = File.join(repo_root, "specs", "epics", "*", "*-tasks.yaml")
Dir[tasks_glob].sort.each do |tasks_path|
  document = YAML.safe_load(File.read(tasks_path), [], [], false) || {}
  next unless document.is_a?(Hash)

  story_id = document["story_id"] || document["id"]
  Array(document["stories"]).each do |story|
    next unless story.is_a?(Hash)

    emit.call(story["id"], tasks_path, story["status"] || document["status"], story["verify"])
  end

  Array(document["tasks"]).each do |task|
    next unless task.is_a?(Hash)

    emit.call(task["id"] || story_id, tasks_path, task["status"] || document["status"], task["verify"])
  end
end
