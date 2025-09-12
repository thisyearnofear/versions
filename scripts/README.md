# 🔧 VERSIONS - Scripts Directory

## **Development Scripts**

### **Build & Verification**
- **`verify_build.sh`** - Verify all components build correctly
- **`build_termusic.sh`** - Legacy build script (use Makefile instead)

### **Testing**
- **`test_server.sh`** - Test all API endpoints
- **`test_api.sh`** - Legacy API testing (use test_server.sh)

## **Usage**

### **Quick Development Workflow**
```bash
# 1. Verify build
./scripts/verify_build.sh

# 2. Test API
./scripts/test_server.sh
```

### **Recommended Workflow**
```bash
# Use Makefile for builds
make build
make test

# Use scripts for verification
./scripts/verify_build.sh
./scripts/test_server.sh
```

## **Script Guidelines**

Following our **Core Principles**:
- **CLEAN**: Each script has single responsibility
- **ORGANIZED**: Predictable naming and structure
- **PERFORMANT**: Efficient execution with clear output
- **DRY**: Avoid duplicating Makefile functionality