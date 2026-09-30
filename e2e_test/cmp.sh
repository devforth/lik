#!/usr/bin/env bash
# usage: cmp.sh dirA dirB diffDir -> differing pixel count per screenshot (fuzz 3%)
A=$1; B=$2; D=$3; mkdir -p "$D"
for f in "$A"/*.png; do
  n=$(basename "$f")
  if [[ ! -f "$B/$n" ]]; then echo "$n MISSING"; continue; fi
  px=$(compare -metric AE -fuzz 3% "$f" "$B/$n" "$D/$n" 2>&1 >/dev/null | awk '{print $1}')
  echo "$n $px"
done
