#!/usr/bin/env bash
# Record Bigpowers skill timings with Ruby's standard YAML library.
set -euo pipefail

if [[ $# -ne 2 || ( "$1" != "start" && "$1" != "end" ) || -z "$2" ]]; then
  echo "Usage: $0 start|end <skill-name>" >&2
  exit 1
fi

STATE_YAML="${BP_STATE_YAML:-specs/state.yaml}"
ACTION="$1"
SKILL="$2"
STAMP="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

ruby -ryaml -rtime - "$STATE_YAML" "$ACTION" "$SKILL" "$STAMP" <<'RUBY'
path, action, skill, stamp = ARGV
data = if File.file?(path)
  YAML.safe_load(File.read(path), aliases: false) || {}
else
  {}
end

data = {} unless data.is_a?(Hash)
metrics = data["metrics"] ||= {}
timings = metrics["skill_timings"] ||= {}
entry = timings[skill] ||= { "calls" => 0, "total_seconds" => 0, "avg_seconds" => 0 }

if action == "start"
  entry["_start"] = stamp
elsif entry["_start"]
  elapsed = Time.iso8601(stamp) - Time.iso8601(entry.delete("_start"))
  entry["calls"] = entry.fetch("calls", 0) + 1
  entry["total_seconds"] = entry.fetch("total_seconds", 0) + elapsed
  entry["avg_seconds"] = entry["total_seconds"].to_f / entry["calls"]
end

File.write(path, YAML.dump(data))
RUBY
