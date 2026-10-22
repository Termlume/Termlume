// No extra packages or privileges: kernel sysfs interfaces only. Bound discovery and output.
export const temperatureCommand = `n=0; for d in /sys/class/hwmon/hwmon*; do
  [ -d "$d" ] || continue
  name=$(head -c 120 "$d/name" 2>/dev/null)
  for f in "$d"/temp*_input; do
    [ -r "$f" ] || continue
    n=$((n + 1)); [ "$n" -le 64 ] || break
    label=$(head -c 120 "\${f%_input}_label" 2>/dev/null)
    [ -n "$label" ] || label=\${f##*/}
    value=$(head -c 32 "$f" 2>/dev/null)
    printf '%s\\t%s %s\\t%s\\n' "$f" "$name" "$label" "$value"
  done
  [ "$n" -lt 64 ] || break
done
if [ "$n" -lt 64 ]; then
  for d in /sys/class/thermal/thermal_zone*; do
    [ -r "$d/temp" ] || continue
    n=$((n + 1)); [ "$n" -le 64 ] || break
    label=$(head -c 120 "$d/type" 2>/dev/null)
    value=$(head -c 32 "$d/temp" 2>/dev/null)
    printf '%s\\t%s\\t%s\\n' "$d/temp" "$label" "$value"
  done
fi`

export function parseTemperatures(output: string) {
  const sensors: { id: string; label: string; celsius: number }[] = []
  for (const line of output.slice(0, 32768).split(/\r?\n/).slice(0, 64)) {
    const [id, label, raw] = line.split('\t')
    if (!id || !/^\/sys\/class\/(hwmon|thermal)\//.test(id) || !/^-?\d+$/.test(raw || '')) continue
    const celsius = Number(raw) / 1000
    if (
      !Number.isFinite(celsius) ||
      celsius < -100 ||
      celsius > 250 ||
      sensors.some((s) => s.id === id)
    )
      continue
    sensors.push({
      id,
      label: label?.trim().slice(0, 240) || id.split('/').slice(-2).join('/'),
      celsius,
    })
  }
  return sensors.length ? sensors : undefined
}
