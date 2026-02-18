import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getRpID, getOrigin } from '../pages/api/vault/passkey/utils.js';

describe('Passkey Utils', () => {
    const originalEnv = process.env;

    beforeEach(() => {
        process.env = { ...originalEnv };
        delete process.env.WEBAUTHN_RP_ID;
        delete process.env.WEBAUTHN_ORIGIN;
    });

    afterEach(() => {
        process.env = originalEnv;
    });

    describe('getRpID', () => {
        it('should return process.env.WEBAUTHN_RP_ID if set', () => {
            process.env.WEBAUTHN_RP_ID = 'example.com';
            const req = { headers: { host: 'localhost' } };
            expect(getRpID(req)).toBe('example.com');
        });

        it('should use X-Forwarded-Host if present', () => {
            const req = { headers: { 'x-forwarded-host': 'my.nudlers.com' } };
            expect(getRpID(req)).toBe('my.nudlers.com');
        });

        it('should use the first X-Forwarded-Host if multiple are present', () => {
            const req = { headers: { 'x-forwarded-host': 'my.nudlers.com, proxy.com' } };
            expect(getRpID(req)).toBe('my.nudlers.com');
        });

        it('should fallback to Host header if X-Forwarded-Host is missing', () => {
            const req = { headers: { host: 'localhost:3000' } };
            expect(getRpID(req)).toBe('localhost');
        });

        it('should strip port from Host header', () => {
            const req = { headers: { host: 'my.nudlers.com:8080' } };
            expect(getRpID(req)).toBe('my.nudlers.com');
        });

        it('should default to localhost if no headers are present', () => {
            const req = { headers: {} };
            expect(getRpID(req)).toBe('localhost');
        });
    });

    describe('getOrigin', () => {
        it('should return process.env.WEBAUTHN_ORIGIN if set', () => {
            process.env.WEBAUTHN_ORIGIN = 'https://example.com';
            const req = { headers: { host: 'localhost' } };
            expect(getOrigin(req)).toBe('https://example.com');
        });

        it('should construct origin from X-Forwarded-Proto and X-Forwarded-Host', () => {
            const req = {
                headers: {
                    'x-forwarded-proto': 'https',
                    'x-forwarded-host': 'my.nudlers.com'
                }
            };
            expect(getOrigin(req)).toBe('https://my.nudlers.com');
        });

        it('should use first X-Forwarded-Proto if multiple', () => {
            const req = {
                headers: {
                    'x-forwarded-proto': 'https, http',
                    'x-forwarded-host': 'my.nudlers.com'
                }
            };
            expect(getOrigin(req)).toBe('https://my.nudlers.com');
        });

        it('should fallback to http if X-Forwarded-Proto is missing', () => {
            const req = {
                headers: {
                    'x-forwarded-host': 'my.nudlers.com'
                }
            };
            expect(getOrigin(req)).toBe('http://my.nudlers.com');
        });

        it('should fallback to Host request header if X-Forwarded-Host is missing', () => {
            const req = {
                headers: {
                    host: 'localhost:3000'
                }
            };
            expect(getOrigin(req)).toBe('http://localhost:3000');
        });

        it('should default to localhost:6969 if no headers present', () => {
            const req = { headers: {} };
            expect(getOrigin(req)).toBe('http://localhost:6969');
        });
    });
});
