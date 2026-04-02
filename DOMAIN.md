# Setting Up a Subdomain Host on Cloudflare

This guide explains how to configure a domain (e.g., `weliketech.eu.org`) on Cloudflare so it acts as a **subdomain hosting platform** — meaning users can deploy projects to addresses like `myproject.weliketech.eu.org`.

---

## Prerequisites

- A Cloudflare account ([cloudflare.com](https://cloudflare.com))
- A domain name added to Cloudflare (the registrar DNS must point to Cloudflare's nameservers)
- A running deployment server (the service that receives deploy requests and maps subdomains to containers/functions — this is your "screenshit" server in Onlook)

---

## Step 1 — Add Your Domain to Cloudflare

1. Log in to [dash.cloudflare.com](https://dash.cloudflare.com)
2. Click **Add a Site** and enter your domain (e.g., `weliketech.eu.org`)
3. Choose the **Free plan** or higher
4. Cloudflare will scan your existing DNS records — review and confirm them
5. Copy the two **Cloudflare nameservers** shown (e.g., `alice.ns.cloudflare.com`)
6. Go to your domain registrar and replace the existing nameservers with Cloudflare's ones
7. Wait for DNS propagation (usually 5–30 minutes)

> [!NOTE]
> You can get a free `.eu.org` domain at [nic.eu.org](https://nic.eu.org) and set the nameservers there. Free domains like `.dpdns.org` can be registered at [desec.io](https://desec.io).

---

## Step 2 — Create a Wildcard DNS Record

A wildcard DNS record routes any subdomain (e.g., `myproject.weliketech.eu.org`) to your deployment server.

1. In the Cloudflare dashboard, go to **DNS → Records**
2. Click **Add Record**
3. Fill in the fields:

| Field   | Value                                     |
|---------|-------------------------------------------|
| Type    | `CNAME`                                   |
| Name    | `*`                                       |
| Target  | `your-deployment-server.example.com`      |
| Proxy   | ✅ **Proxied** (orange cloud)              |
| TTL     | Auto                                      |

> [!IMPORTANT]
> Replace `your-deployment-server.example.com` with the actual hostname of your deployment backend (e.g., your screenshit server's public domain or IP with a CNAME alias). For Onlook, this is the screenshit lambda/express endpoint.

4. Click **Save**

Your wildcard record now routes all subdomains through Cloudflare's proxy to your server.

---

## Step 3 — Enable SSL/TLS

1. In the Cloudflare dashboard, go to **SSL/TLS → Overview**
2. Set the encryption mode to **Full (strict)** — this ensures end-to-end encryption between Cloudflare and your server
3. Go to **SSL/TLS → Edge Certificates** and ensure:
   - **Always Use HTTPS** is enabled
   - **Minimum TLS Version** is set to TLS 1.2

> [!TIP]
> Cloudflare automatically issues a **wildcard edge certificate** for `*.weliketech.eu.org` so all subdomains get HTTPS instantly with no extra configuration.

---

## Step 4 — Configure Your Deployment Server

Your backend server must:

1. **Accept all incoming Host headers** matching `*.weliketech.eu.org`
2. **Extract the subdomain** from the request's `Host` header to route to the correct project
3. **Respond with the correct project content**

Example (Node.js/Express):

```js
app.use((req, res, next) => {
    const host = req.headers.host; // e.g., "myproject.weliketech.eu.org"
    const subdomain = host?.split('.')[0]; // "myproject"
    
    // Look up project by subdomain and serve its files/proxy
    const project = projectStore.findBySubdomain(subdomain);
    if (!project) return res.status(404).send('Project not found');
    
    // ... serve project
});
```

---

## Step 5 — Add Custom Domains (Optional — for users who own their own domain)

When a user wants to use their own domain (e.g., `mybrand.com`) to point to their Onlook-hosted project:

1. Your server registers the custom domain with Cloudflare using the **Cloudflare for SaaS** feature (also called **Custom Hostnames**)
2. Cloudflare issues a **verification TXT record** and a **CNAME record** for the user to add at their DNS provider
3. Once verified, Cloudflare routes traffic from `mybrand.com` through the same proxy to your server

### Setting up Cloudflare for SaaS

1. In the Cloudflare dashboard, go to **SSL/TLS → Custom Hostnames**
2. Click **Get Started** (requires a Pro plan or higher, or purchasing the SaaS feature)
3. Set the **Fallback Origin** to your main server's hostname (e.g., `proxy-fallback.weliketech.eu.org`)
4. Use the Cloudflare API to add custom hostnames programmatically when users add their domains:

```bash
curl -X POST "https://api.cloudflare.com/client/v4/zones/{ZONE_ID}/custom_hostnames" \
  -H "Authorization: Bearer {API_TOKEN}" \
  -H "Content-Type: application/json" \
  --data '{
    "hostname": "mybrand.com",
    "ssl": {
      "method": "txt",
      "type": "dv",
      "settings": {
        "min_tls_version": "1.2"
      }
    }
  }'
```

5. The API response will contain the **TXT verification records** to show the user so they can complete DNS ownership verification

> [!IMPORTANT]
> Cloudflare for SaaS requires the zone to be on a **Pro plan or higher**. Alternatively, you can use the **Cloudflare API with a Business zone** or leverage **Cloudflare Workers** for more complex routing.

---

## Step 6 — Environment Variables

Set the following environment variables on your Onlook server:

```env
CLOUDFLARE_ZONE_ID=your_zone_id_here
CLOUDFLARE_API_TOKEN=your_api_token_here
# Optional: restrict to a specific subdomain pattern
SUBDOMAIN_BASE_DOMAIN=weliketech.eu.org
```

To find your **Zone ID**:
- Go to Cloudflare dashboard → select your domain → scroll down on the **Overview** page → copy the **Zone ID** from the right sidebar

To create an **API Token**:
- Go to **My Profile → API Tokens → Create Token**
- Use the **Edit zone DNS** template and scope it to your specific zone

---

## Troubleshooting

| Issue | Solution |
|-------|---------- |
| Subdomain not resolving | Check wildcard `*` CNAME is proxied (orange cloud) |
| SSL certificate error | Ensure SSL mode is **Full (strict)**, not **Flexible** |
| Custom domain verification failing | Make sure the user added both TXT records (ownership + SSL) correctly |
| 502/504 errors | Check your origin server is running and accepts connections from Cloudflare IPs |
| Changes not propagating | DNS TTL may need time; Cloudflare proxied records typically update in seconds |

---

## Quick Reference — DNS Record Summary

For the **subdomain host** (your side):

| Type  | Name | Value                              |
|-------|------|------------------------------------|
| CNAME | `*`  | `your-deployment-server.example.com` |

For **custom domain users** (their DNS provider):

| Type  | Name                        | Value                             |
|-------|-----------------------------|-----------------------------------|
| CNAME | `@` or their subdomain      | `proxy-fallback.weliketech.eu.org` |
| TXT   | `_cf-custom-hostname.@`     | Cloudflare ownership token        |
| TXT   | `_acme-challenge.@`         | Cloudflare SSL challenge token    |

> [!TIP]
> Onlook's publish popup shows users the exact DNS records they need to add, pre-formatted and click-to-copy for convenience.
