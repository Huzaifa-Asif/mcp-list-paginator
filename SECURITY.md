# Security Policy

## Supported versions

Security fixes are provided for the latest published major version.

## Reporting a vulnerability

Use GitHub's private vulnerability reporting for this repository. Do not open a public issue with exploit details, real cursors, private catalog entries, tokens, or credentials. Include the affected version, impact, minimal reproduction with synthetic data, and suggested mitigation if known.

You should receive an acknowledgement within seven days. Coordinated disclosure is requested until a fix or mitigation is available.

## Security boundaries

Cursors are random bearer capabilities, not authorization credentials. Applications must repeat authorization and visibility checks for each request, isolate paginator instances when callers have different catalog visibility, and clear affected snapshots after access revocation. Snapshot state is held in process memory and item objects are shallow references. `maxItems` and `maxSnapshots` bound retained cardinality, but applications still control item size. This package does not persist, encrypt, authenticate, or synchronize state between processes.
