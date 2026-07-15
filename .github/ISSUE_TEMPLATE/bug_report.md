---
name: Bug report
about: Report something that's broken or behaves unexpectedly
title: "[bug] "
labels: bug, needs-triage
assignees: ""
---

## Summary

<!-- One or two sentences describing the bug. -->

## Steps to reproduce

1.
2.
3.

## Expected behaviour

<!-- What you expected to happen. -->

## Actual behaviour

<!-- What actually happened. -->

## Environment

- **ChildCheck version**: <!-- `childcheck version` or first line of `docker logs childcheck` -->
- **Install method**: <!-- Docker / Linux native / macOS native / Windows native / Synology NAS -->
- **OS**: <!-- e.g. Ubuntu 22.04, macOS 14, Windows Server 2022, Synology DSM 7.2 -->
- **Architecture**: <!-- x86_64 / arm64 -->
- **Browser** (if relevant): <!-- e.g. Chrome 120, Safari 17, Firefox 121 -->

## Logs

```
Paste the relevant log snippet here.
- Docker: `docker compose logs childcheck | tail -100`
- Linux:  `journalctl -u childcheck -n 100`
- macOS:  `tail -100 ~/Library/Application Support/ChildCheck/logs/childcheck.stdout.log`
- Windows: Get-Content "C:\ProgramData\ChildCheck\logs\*.log" -Tail 100
```

## Additional context

<!-- Anything else that might help — screenshots, the relevant person/family
     ID (redact names if it's real data), whether it's reproducible on a
     fresh install, etc. -->
