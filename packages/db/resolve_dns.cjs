const dns = require('dns');

const hosts = [
    'db.nyueaqcjywupgqjcugzr.supabase.co',
    'aws-0-us-west-2.pooler.supabase.com'
];

hosts.forEach(host => {
    dns.lookup(host, { all: true }, (err, addresses) => {
        if (err) {
            console.error(`Error resolving ${host}:`, err);
        } else {
            console.log(`Resolved ${host}:`, addresses);
        }
    });
});
