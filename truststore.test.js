const fs = require("fs");
const os = require("os");
const path = require("path");
const { X509Certificate } = require("crypto");
const truststore = require("./truststore");

const ROOT = truststore.TRUSTED_ROOTS[0];

const FINGERPRINT =
    "8F:AF:7D:2E:2C:B4:70:9B:B8:E0:B3:36:66:BF:75:A5:DD:45:B5:DE:48:0F:8E:A8:D4:BF:E6:BE:BC:17:F2:ED";

const OTHER_FINGERPRINT =
    "4F:F4:60:D5:4B:9C:86:DA:BF:BC:FC:57:12:E0:40:0D:2B:ED:3F:BC:4D:4F:BD:AA:86:E0:6A:DC:D2:A9:AD:7A";

// Shape copied from a real `keytool -list` run on windows-latest. It wraps the fingerprint
// onto its own line, which is why the parser must not join lines.
function keytoolList(alias, fingerprint) {
    return [
        "Keystore type: PKCS12",
        "Keystore provider: SUN",
        "",
        "Your keystore contains 91 entries",
        "",
        `${alias}, Sep 23, 2026, trustedCertEntry, `,
        "  Certificate fingerprint (SHA-256): ",
        fingerprint,
        "usertrusteccca [jdk], Dec 1, 2017, trustedCertEntry, ",
        "  Certificate fingerprint (SHA-256): ",
        OTHER_FINGERPRINT,
    ].join("\n");
}

const tempDirs = [];

function makeTree(files) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "truststore-test-"));
    tempDirs.push(dir);
    files.forEach((relative) => {
        const full = path.join(dir, relative);
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, "");
    });
    return dir;
}

afterAll(() => {
    tempDirs.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true }));
});

describe("vendored root certificate", () => {
    const pemPath = path.join(truststore.certsDir(), ROOT.file);
    const pem = fs.readFileSync(pemPath, "utf8");
    const cert = new X509Certificate(pem);

    // Guards the rotation process: a swapped PEM fails here before it can change what we trust.
    test("matches the pinned fingerprint", () => {
        expect(truststore.pemFingerprint(pem)).toBe(truststore.normalizeFingerprint(ROOT.sha256));
        expect(truststore.normalizeFingerprint(cert.fingerprint256)).toBe(
            truststore.normalizeFingerprint(ROOT.sha256)
        );
    });

    test("subject matches the recorded metadata", () => {
        expect(cert.subject).toContain("SSL.com TLS RSA Root CA 2022");
        expect(ROOT.subject).toContain("SSL.com TLS RSA Root CA 2022");
    });

    test("is a self-signed root", () => {
        expect(cert.issuer).toBe(cert.subject);
        expect(cert.verify(cert.publicKey)).toBe(true);
        expect(cert.ca).toBe(true);
    });

    test("has not expired and matches the recorded expiry", () => {
        expect(new Date(cert.validTo).getTime()).toBeGreaterThan(Date.now());
        expect(new Date(cert.validTo).getTime()).toBe(new Date(ROOT.notAfter).getTime());
    });

    test("loadTrustedRoots resolves it", () => {
        const roots = truststore.loadTrustedRoots();
        expect(roots).toHaveLength(1);
        expect(roots[0].alias).toBe(ROOT.alias);
        expect(fs.existsSync(roots[0].pemPath)).toBe(true);
    });

    test("loadTrustedRoots rejects a tampered certificate", () => {
        const dir = makeTree([]);
        fs.writeFileSync(
            path.join(dir, ROOT.file),
            pem.replace("MIIFiTCCA3Gg", "MIIFiTCCA3Gh")
        );
        expect(() => truststore.loadTrustedRoots(dir)).toThrow(/Fingerprint mismatch/);
    });
});

describe("normalizeFingerprint", () => {
    test("ignores separators, case and padding", () => {
        expect(truststore.normalizeFingerprint("aa:bb:cc")).toBe("AABBCC");
        expect(truststore.normalizeFingerprint("  AA BB cc \n")).toBe("AABBCC");
    });

    // It takes a bare fingerprint. Pulling one out of labelled text is extractFingerprints' job.
    test("keeps every hex character, so labels must be stripped first", () => {
        expect(truststore.normalizeFingerprint("SHA256=aa:bb")).toBe("A256AABB");
        expect(truststore.extractFingerprints(`Certificate fingerprint (SHA-256): ${FINGERPRINT}`)).toEqual([
            truststore.normalizeFingerprint(FINGERPRINT),
        ]);
    });

    test("handles empty input", () => {
        expect(truststore.normalizeFingerprint(null)).toBe("");
        expect(truststore.normalizeFingerprint(undefined)).toBe("");
        expect(truststore.normalizeFingerprint("")).toBe("");
    });
});

describe("pemFingerprint", () => {
    test("rejects text with no certificate block", () => {
        expect(() => truststore.pemFingerprint("not a certificate")).toThrow(/No PEM certificate/);
    });

    test("rejects an empty certificate block", () => {
        const empty = "-----BEGIN CERTIFICATE-----\n-----END CERTIFICATE-----";
        expect(() => truststore.pemFingerprint(empty)).toThrow(/empty/);
    });
});

describe("isTrustAnchorPresent", () => {
    test("finds the anchor under our own alias", () => {
        expect(truststore.isTrustAnchorPresent(keytoolList(ROOT.alias, FINGERPRINT), ROOT.sha256)).toBe(
            true
        );
    });

    // The case where SSL.com ships the root themselves: the alias is theirs, not ours.
    test("finds the anchor under a different alias", () => {
        const listing = keytoolList("sslcomtlsrsarootca2022 [jdk]", FINGERPRINT);
        expect(truststore.isTrustAnchorPresent(listing, ROOT.sha256)).toBe(true);
    });

    test("reports absent when the keystore holds other certificates", () => {
        const listing = keytoolList("someotherca [jdk]", OTHER_FINGERPRINT);
        expect(truststore.isTrustAnchorPresent(listing, ROOT.sha256)).toBe(false);
    });

    test("reports absent for output that lists only SHA-1 fingerprints", () => {
        const listing = "myca, Dec 1, 2017, trustedCertEntry,\n  Certificate fingerprint (SHA1): AA:BB:CC:DD";
        expect(truststore.isTrustAnchorPresent(listing, ROOT.sha256)).toBe(false);
    });

    test("does not join two lines into a false match", () => {
        const split = "8F:AF:7D:2E:2C:B4:70:9B:B8:E0:B3:36:66:BF:75:A5\nDD:45:B5:DE:48:0F:8E:A8:D4:BF:E6:BE:BC:17:F2:ED";
        expect(truststore.isTrustAnchorPresent(split, ROOT.sha256)).toBe(false);
    });

    test("survives empty and truncated output", () => {
        expect(truststore.isTrustAnchorPresent("", ROOT.sha256)).toBe(false);
        expect(truststore.isTrustAnchorPresent(null, ROOT.sha256)).toBe(false);
        expect(truststore.isTrustAnchorPresent(keytoolList(ROOT.alias, FINGERPRINT), "")).toBe(false);
    });
});

describe("findBundledJre", () => {
    test("finds the JDK 9+ layout that CodeSignTool ships", () => {
        const dir = makeTree([
            "jdk-11.0.2/bin/keytool.exe",
            "jdk-11.0.2/lib/security/cacerts",
            "jar/code_sign_tool.jar",
        ]);
        const jre = truststore.findBundledJre(dir);
        expect(jre).not.toBeNull();
        expect(jre.keytool).toBe(path.join(dir, "jdk-11.0.2", "bin", "keytool.exe"));
        expect(jre.cacerts).toBe(path.join(dir, "jdk-11.0.2", "lib", "security", "cacerts"));
    });

    test("finds the older JDK 8 layout", () => {
        const dir = makeTree(["jre1.8.0_401/bin/keytool.exe", "jre1.8.0_401/jre/lib/security/cacerts"]);
        const jre = truststore.findBundledJre(dir);
        expect(jre).not.toBeNull();
        expect(jre.cacerts).toContain(path.join("jre", "lib", "security", "cacerts"));
    });

    test("returns null when keytool is missing", () => {
        const dir = makeTree(["jdk-11.0.2/lib/security/cacerts"]);
        expect(truststore.findBundledJre(dir)).toBeNull();
    });

    test("returns null when cacerts is missing", () => {
        const dir = makeTree(["jdk-11.0.2/bin/keytool.exe"]);
        expect(truststore.findBundledJre(dir)).toBeNull();
    });

    test("ignores folders that are not a JDK", () => {
        const dir = makeTree(["conf/code_sign_tool.properties", "logs/tool.log"]);
        expect(truststore.findBundledJre(dir)).toBeNull();
    });

    test("returns null for a directory that does not exist", () => {
        expect(truststore.findBundledJre(path.join(os.tmpdir(), "no-such-dir-12345"))).toBeNull();
    });
});

describe("keytool arguments", () => {
    test("the list command targets the keystore", () => {
        const args = truststore.buildKeytoolListArgs({ cacerts: "C:\\jdk\\cacerts" });
        expect(args).toEqual(["-list", "-keystore", "C:\\jdk\\cacerts", "-storepass", "changeit"]);
    });

    test("the import command never prompts", () => {
        const args = truststore.buildKeytoolImportArgs({
            cacerts: "C:\\jdk\\cacerts",
            pemPath: "C:\\certs\\root.pem",
            alias: "acre-test",
        });
        expect(args).toContain("-importcert");
        expect(args).toContain("-noprompt");
        expect(args).toContain("-trustcacerts");
        expect(args[args.indexOf("-alias") + 1]).toBe("acre-test");
        expect(args[args.indexOf("-file") + 1]).toBe("C:\\certs\\root.pem");
        expect(args[args.indexOf("-keystore") + 1]).toBe("C:\\jdk\\cacerts");
    });
});

describe("classifyExecResult", () => {
    test("accepts a clean run", () => {
        const result = truststore.classifyExecResult({
            err: null,
            stdout: "Code signed successfully",
            stderr: "",
        });
        expect(result.ok).toBe(true);
    });

    // This warning appears on every run. The old check failed the build on any stderr byte.
    test("accepts benign JVM chatter on stderr", () => {
        const result = truststore.classifyExecResult({
            err: null,
            stdout: "Code signed successfully",
            stderr: "WARNING: sun.reflect.Reflection.getCallerClass is not supported.",
        });
        expect(result.ok).toBe(true);
        expect(result.output).toContain("WARNING");
    });

    test("accepts the JVM option notices that blocked every workaround", () => {
        ["Picked up JAVA_TOOL_OPTIONS: -Dx", "NOTE: Picked up JDK_JAVA_OPTIONS: -Dx"].forEach(
            (notice) => {
                expect(
                    truststore.classifyExecResult({ err: null, stdout: "Code signed successfully", stderr: notice })
                        .ok
                ).toBe(true);
            }
        );
    });

    test("fails on a non-zero exit and keeps stdout", () => {
        const result = truststore.classifyExecResult({
            err: new Error("Command failed: CodeSignTool.bat"),
            stdout: "PKIX path building failed",
            stderr: "",
        });
        expect(result.ok).toBe(false);
        expect(result.output).toContain("PKIX path building failed");
    });

    test("fails when the tool reports an error on stdout only", () => {
        const result = truststore.classifyExecResult({
            err: null,
            stdout: "Error: invalid otp",
            stderr: "",
        });
        expect(result.ok).toBe(false);
        expect(result.output).toContain("invalid otp");
    });

    test("tolerates missing streams", () => {
        expect(truststore.classifyExecResult({ err: null }).ok).toBe(true);
    });
});

describe("ensureTrustedRoots", () => {
    test("warns and continues when no bundled JRE is present", async () => {
        const dir = makeTree(["conf/code_sign_tool.properties"]);
        const warnings = [];
        const result = await truststore.ensureTrustedRoots(dir, { warn: (m) => warnings.push(m) });

        expect(result.skipped).toBe(true);
        expect(result.updated).toBe(false);
        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toContain("No bundled JRE found");
    });

    test("fails loudly when the vendored certificate is tampered with", async () => {
        const certs = makeTree([]);
        const pem = fs.readFileSync(path.join(truststore.certsDir(), ROOT.file), "utf8");
        fs.writeFileSync(path.join(certs, ROOT.file), pem.replace("MIIFiTCCA3Gg", "MIIFiTCCA3Gh"));

        await expect(
            truststore.ensureTrustedRoots(makeTree([]), { certsDir: certs })
        ).rejects.toThrow(/Fingerprint mismatch/);
    });
});
