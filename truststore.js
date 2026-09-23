const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");

// Roots that cs.ssl.com / cs-try.ssl.com need but the JRE bundled in CodeSignTool.zip does not carry.
// The fingerprint is pinned so a swapped PEM fails the unit test and the action instead of
// silently changing what the signing step trusts. See docs on rotation before you edit this.
const TRUSTED_ROOTS = [
    {
        alias: "acre-sslcom-tls-rsa-root-2022",
        file: "sslcom-tls-rsa-root-2022.pem",
        subject: "C=US, O=SSL Corporation, CN=SSL.com TLS RSA Root CA 2022",
        notAfter: "2046-08-19T16:34:21Z",
        sha256: "8FAF7D2E2CB4709BB8E0B33666BF75A5DD45B5DE480F8EA8D4BFE6BEBC17F2ED",
    },
];

const KEYSTORE_PASSWORD = "changeit";

// ncc bundles this file into dist/, so certs/ is either beside it or one level up.
function certsDir() {
    const candidates = [
        path.join(__dirname, "certs"),
        path.join(__dirname, "..", "certs"),
    ];
    return candidates.find((dir) => fs.existsSync(dir)) || candidates[0];
}

function normalizeFingerprint(value) {
    return String(value == null ? "" : value).replace(/[^0-9a-fA-F]/g, "").toUpperCase();
}

function pemFingerprint(pemText) {
    const block = /-----BEGIN CERTIFICATE-----([\s\S]*?)-----END CERTIFICATE-----/.exec(
        String(pemText == null ? "" : pemText)
    );
    if (!block) {
        throw new Error("No PEM certificate block found");
    }
    const der = Buffer.from(block[1].replace(/\s+/g, ""), "base64");
    if (der.length === 0) {
        throw new Error("PEM certificate block is empty");
    }
    return crypto.createHash("sha256").update(der).digest("hex").toUpperCase();
}

// Matches only whole colon-separated fingerprints, so a match cannot span two lines of output.
function extractFingerprints(text) {
    const found = String(text == null ? "" : text).match(
        /(?:[0-9A-Fa-f]{2}:){15,}[0-9A-Fa-f]{2}/g
    );
    return (found || []).map(normalizeFingerprint);
}

function isTrustAnchorPresent(keytoolListOutput, sha256) {
    const wanted = normalizeFingerprint(sha256);
    if (wanted.length === 0) {
        return false;
    }
    return extractFingerprints(keytoolListOutput).indexOf(wanted) !== -1;
}

// CodeSignTool ships a JDK whose name changes between releases, so match on shape, not on name.
function findBundledJre(rootDir) {
    let entries;
    try {
        entries = fs.readdirSync(rootDir);
    } catch (err) {
        return null;
    }

    const candidates = entries.filter((name) => /^(jdk|jre)/i.test(name));

    for (const name of candidates) {
        const jreDir = path.join(rootDir, name);
        const keytool = path.join(jreDir, "bin", "keytool.exe");
        if (!fs.existsSync(keytool)) {
            continue;
        }
        const layouts = [
            path.join(jreDir, "lib", "security", "cacerts"),
            path.join(jreDir, "jre", "lib", "security", "cacerts"),
        ];
        const cacerts = layouts.find((file) => fs.existsSync(file));
        if (cacerts) {
            return { jreDir, keytool, cacerts };
        }
    }
    return null;
}

function buildKeytoolListArgs({ cacerts }) {
    return ["-list", "-keystore", cacerts, "-storepass", KEYSTORE_PASSWORD];
}

function buildKeytoolImportArgs({ cacerts, pemPath, alias }) {
    return [
        "-importcert",
        "-noprompt",
        "-trustcacerts",
        "-alias",
        alias,
        "-file",
        pemPath,
        "-keystore",
        cacerts,
        "-storepass",
        KEYSTORE_PASSWORD,
    ];
}

// CodeSignTool writes its stack traces to stdout, so a report that omits stdout hides the cause.
function classifyExecResult({ err, stdout, stderr }) {
    const out = String(stdout == null ? "" : stdout);
    const errOut = String(stderr == null ? "" : stderr);
    const combined = [out, errOut].filter((part) => part.trim().length > 0).join("\n");

    if (err) {
        return { ok: false, reason: `Command failed: ${err.message}`, output: combined };
    }
    if (/Error/.test(out) || /Error/.test(errOut)) {
        return { ok: false, reason: "Output reported an error", output: combined };
    }
    return { ok: true, reason: "", output: combined };
}

function loadTrustedRoots(dir) {
    const base = dir || certsDir();
    return TRUSTED_ROOTS.map((root) => {
        const pemPath = path.join(base, root.file);
        const pemText = fs.readFileSync(pemPath, "utf8");
        const actual = pemFingerprint(pemText);
        if (actual !== normalizeFingerprint(root.sha256)) {
            throw new Error(
                `Fingerprint mismatch for ${root.file}. Expected ${root.sha256}, found ${actual}.`
            );
        }
        return Object.assign({}, root, { pemPath });
    });
}

function runKeytool(keytool, args) {
    return new Promise((resolve) => {
        execFile(keytool, args, { maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
            resolve({ err, stdout: String(stdout || ""), stderr: String(stderr || "") });
        });
    });
}

// Success means the anchor is present afterwards. keytool refuses with a non-zero exit when the
// certificate is already in the store, and that message has changed between JDK releases.
async function ensureTrustedRoots(rootDir, options) {
    const log = (options && options.log) || (() => { });
    const warn = (options && options.warn) || (() => { });

    const roots = loadTrustedRoots(options && options.certsDir);
    roots.forEach((root) => log(`Vendored root verified: ${root.subject} (${root.sha256})`));

    const jre = findBundledJre(rootDir);
    if (!jre) {
        let listing = "";
        try {
            listing = fs.readdirSync(rootDir).join(", ");
        } catch (err) {
            listing = `unreadable: ${err.message}`;
        }
        warn(
            `No bundled JRE found under ${rootDir}. Skipping the truststore update. ` +
            `Signing continues and uses whatever Java the tool finds. Contents: ${listing}`
        );
        return { updated: false, skipped: true, imported: [], alreadyTrusted: [] };
    }

    log(`Bundled JRE: ${jre.jreDir}`);

    const listed = await runKeytool(jre.keytool, buildKeytoolListArgs(jre));
    const before = `${listed.stdout}\n${listed.stderr}`;
    if (listed.err) {
        warn(`Could not read the bundled truststore: ${listed.err.message}`);
    }

    const imported = [];
    const alreadyTrusted = [];

    for (const root of roots) {
        if (isTrustAnchorPresent(before, root.sha256)) {
            alreadyTrusted.push(root.alias);
            log(`Already trusted by the bundled JRE: ${root.subject}`);
            continue;
        }

        const result = await runKeytool(
            jre.keytool,
            buildKeytoolImportArgs({ cacerts: jre.cacerts, pemPath: root.pemPath, alias: root.alias })
        );

        const after = await runKeytool(jre.keytool, buildKeytoolListArgs(jre));
        const present = isTrustAnchorPresent(`${after.stdout}\n${after.stderr}`, root.sha256);

        if (!present) {
            const detail = [result.stdout, result.stderr].filter((part) => part.trim()).join("\n");
            throw new Error(`Failed to add ${root.subject} to ${jre.cacerts}.\n${detail}`);
        }

        imported.push(root.alias);
        log(`Imported into the bundled JRE: ${root.subject}`);
    }

    return { updated: imported.length > 0, skipped: false, imported, alreadyTrusted };
}

module.exports = {
    TRUSTED_ROOTS,
    KEYSTORE_PASSWORD,
    certsDir,
    normalizeFingerprint,
    pemFingerprint,
    extractFingerprints,
    isTrustAnchorPresent,
    findBundledJre,
    buildKeytoolListArgs,
    buildKeytoolImportArgs,
    classifyExecResult,
    loadTrustedRoots,
    ensureTrustedRoots,
};
