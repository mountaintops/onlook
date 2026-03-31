function getDnsHost(txtName, hostname) {
    if (!txtName || !hostname) return txtName;
    const parts = hostname.split('.');
    if (parts.length < 2) return txtName;
    const rootDomain = parts.slice(-2).join('.');
    if (txtName.endsWith('.' + rootDomain)) {
        return txtName.slice(0, -(rootDomain.length + 1));
    }
    return txtName;
}

const tests = [
    { txt: "_acme-challenge.website.dpdns.org", host: "website.dpdns.org", expected: "_acme-challenge.website" },
    { txt: "_acme-challenge.project.example.com", host: "project.example.com", expected: "_acme-challenge.project" },
    { txt: "_acme-challenge.example.com", host: "example.com", expected: "_acme-challenge" },
    { txt: "_cloudflare-auth.my-blog.me.uk", host: "my-blog.me.uk", expected: "_cloudflare-auth.my-blog" }, // me.uk will treat uk as TLD and me as second-level
];

tests.forEach(({ txt, host, expected }) => {
    const result = getDnsHost(txt, host);
    console.log(`Input: ${txt}, Hostname: ${host} => Result: ${result} (Expected: ${expected})`);
    if (result !== expected) {
        console.error("❌ FAILED");
    } else {
        console.log("✅ PASSED");
    }
});
