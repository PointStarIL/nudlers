/**
 * VaultStore is a simple in-memory singleton to store the decrypted master key.
 * This key is lost when the application process restarts.
 */
class VaultStore {
    constructor() {
        this.masterKey = null;
        this._initialized = false;
    }

    setInitialized(val) {
        this._initialized = !!val;
    }

    isInitialized() {
        return this._initialized;
    }

    setKey(key) {
        if (!Buffer.isBuffer(key) || key.length !== 32) {
            throw new Error('VaultStore: Master key must be a 32-byte Buffer');
        }
        this.masterKey = key;
    }

    getKey() {
        return this.masterKey;
    }

    clear() {
        if (this.masterKey) {
            this.masterKey.fill(0);
        }
        this.masterKey = null;
    }

    isLocked() {
        return this.masterKey === null;
    }
}

// Singleton instance
const instance = new VaultStore();
export default instance;
