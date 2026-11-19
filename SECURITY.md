# Security policy

Please report vulnerabilities privately through
[GitHub security advisories](https://github.com/mrRedSun/system-map/security/advisories/new),
not in public issues. Include the image tag or commit, what an attacker can do, and steps to
reproduce with fictional data.

Only the latest `main` image is supported. Fixes ship as a new image; the advisory says which tag
to deploy.

System Map has no login of its own: it expects an authenticating reverse proxy in front of it (see
the README). Reports about access without that proxy are out of scope.
