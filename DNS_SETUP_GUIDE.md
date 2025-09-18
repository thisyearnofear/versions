# 🌐 DNS Setup Guide for VERSIONS

## **Your Domain Configuration**
- **Domain**: `thisyearnofear.com`
- **Registrar**: GoDaddy
- **Nameservers**: ns57.domaincontrol.com, ns58.domaincontrol.com
- **Target**: Add subdomain `versions.thisyearnofear.com`

## **🎯 Step-by-Step DNS Setup**

### **Step 1: Access GoDaddy DNS Management**

1. **Go to GoDaddy**: https://www.godaddy.com
2. **Sign In**: Use your GoDaddy account credentials
3. **Navigate to Domains**: 
   - Click "My Products" or "Domains"
   - Find `thisyearnofear.com` in your domain list
4. **Access DNS**: 
   - Click "DNS" or "Manage DNS" next to your domain
   - This opens the DNS management interface

### **Step 2: Add the A Record**

In the DNS management interface:

1. **Find DNS Records Section**: Look for "DNS Records" or "Zone File"
2. **Add New Record**: Click "Add" or "+" button
3. **Configure the Record**:
   ```
   Type: A
   Name: versions
   Value: 2a01:4f9:c012:105d::1
   TTL: 600 (or leave default)
   ```

### **Step 3: Detailed Field Instructions**

#### **Record Type**
- Select: **A** (not AAAA, CNAME, or others)

#### **Name/Host Field**
- Enter: **versions**
- Do NOT include the full domain (GoDaddy adds .thisyearnofear.com automatically)
- Do NOT use @ symbol

#### **Value/Points To Field**
- Enter: **2a01:4f9:c012:105d::1**
- This is your Hetzner server's IPv6 address
- Copy/paste to avoid typos

#### **TTL (Time To Live)**
- Use: **600** (10 minutes) or **300** (5 minutes)
- This controls how quickly changes propagate

### **Step 4: Save and Verify**

1. **Save Changes**: Click "Save" or "Add Record"
2. **Confirm**: The record should appear in your DNS list
3. **Wait**: DNS propagation takes 5-30 minutes

## **🔍 Verification Steps**

### **Check DNS Propagation**

#### **Method 1: Command Line**
```bash
# Check if DNS is working
nslookup versions.thisyearnofear.com

# Should return: 2a01:4f9:c012:105d::1
```

#### **Method 2: Online Tools**
- Visit: https://dnschecker.org
- Enter: `versions.thisyearnofear.com`
- Check if it resolves to `2a01:4f9:c012:105d::1`

#### **Method 3: Browser Test**
- Try visiting: http://versions.thisyearnofear.com
- Should show Nginx default page or connection error (normal before SSL)

### **Expected Results**

#### **✅ Success Indicators**
- DNS lookup returns: `2a01:4f9:c012:105d::1`
- Browser shows connection (even if SSL error)
- No "domain not found" errors

#### **❌ Common Issues**
- **"Domain not found"**: DNS record not added or propagating
- **Wrong IP**: Check the IP address in the A record
- **Still propagating**: Wait 5-30 minutes and try again

## **🚨 Troubleshooting**

### **If DNS Doesn't Work**

#### **Check Record Configuration**
1. **Verify Type**: Must be "A" record
2. **Check Name**: Should be "versions" (not "versions.thisyearnofear.com")
3. **Verify IP**: Must be `2a01:4f9:c012:105d::1`
4. **TTL**: Should be 300-600 seconds

#### **Common GoDaddy Issues**
- **Name Field**: Don't include the full domain
- **IP Format**: Use IPv6 format (with colons)
- **Caching**: Clear browser cache and try again

#### **Alternative: Use IPv4 (If IPv6 Doesn't Work)**
If IPv6 causes issues, we can use IPv4:
```
Type: A
Name: versions
Value: 157.180.36.156
TTL: 600
```

### **Propagation Time**
- **Typical**: 5-15 minutes
- **Maximum**: Up to 48 hours (rare)
- **Speed up**: Use lower TTL (300 seconds)

## **📱 GoDaddy Interface Screenshots Guide**

### **What to Look For:**

1. **Domain List**: Find `thisyearnofear.com`
2. **DNS Button**: Usually says "DNS", "Manage DNS", or has a gear icon
3. **Records Table**: Shows existing A, CNAME, MX records
4. **Add Button**: Usually "+" or "Add Record"
5. **Record Form**: Fields for Type, Name, Value, TTL

### **Visual Confirmation**
After adding, you should see:
```
Type | Name     | Value                    | TTL
A    | versions | 2a01:4f9:c012:105d::1   | 600
```

## **⏰ Timeline After DNS Setup**

### **Immediate (0-5 minutes)**
- Record appears in GoDaddy interface
- Some DNS checkers may show the record

### **Short Term (5-15 minutes)**
- Most DNS servers worldwide have the record
- `nslookup` commands work
- Browser can resolve the domain

### **Complete (15-30 minutes)**
- All DNS servers updated
- SSL certificate can be issued
- VERSIONS platform accessible

## **🎯 Next Steps After DNS Works**

### **When DNS Resolves Successfully**

1. **Check Build Status**:
   ```bash
   ssh snel-bot 'ls -la /opt/versions/target/release/termusic-server'
   ```

2. **Setup SSL Certificate**:
   ```bash
   ssh snel-bot 'certbot --nginx -d versions.thisyearnofear.com'
   ```

3. **Start VERSIONS Service**:
   ```bash
   ssh snel-bot 'systemctl start versions-server'
   ```

4. **Test Platform**:
   ```bash
   curl https://versions.thisyearnofear.com/api/v1/health
   ```

---

## **🎉 Summary**

**Add this DNS record in GoDaddy:**
```
Type: A
Name: versions
Value: 2a01:4f9:c012:105d::1
TTL: 600
```

**Then verify with:**
```bash
nslookup versions.thisyearnofear.com
```

**Status**: 🎯 **DNS SETUP REQUIRED - FOLLOW GODADDY STEPS ABOVE**