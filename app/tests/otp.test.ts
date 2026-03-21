import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the logger
vi.mock('../utils/logger.js', () => ({
    default: {
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn()
    }
}));

describe('OTP API Handler', () => {
    let handler: any;
    let waitForOtp: any;
    let hasPendingOtp: any;
    let clearPendingOtp: any;

    beforeEach(async () => {
        // Reset global OTP store before each test
        (global as any).otpStore = {
            resolve: null,
            reject: null,
            companyId: null,
            timestamp: null,
        };

        // Import fresh module
        const mod = await import('../pages/api/scrapers/otp');
        handler = mod.default;
        waitForOtp = mod.waitForOtp;
        hasPendingOtp = mod.hasPendingOtp;
        clearPendingOtp = mod.clearPendingOtp;
    });

    afterEach(() => {
        // Clean up any pending OTP
        if ((global as any).otpStore?.reject) {
            (global as any).otpStore.reject(new Error('test cleanup'));
        }
        (global as any).otpStore = {
            resolve: null,
            reject: null,
            companyId: null,
            timestamp: null,
        };
        vi.restoreAllMocks();
    });

    describe('waitForOtp', () => {
        it('should return a promise that resolves when code is submitted', async () => {
            const promise = waitForOtp('hapoalim', 5000);

            // Simulate submitting OTP
            setTimeout(() => {
                const resolve = (global as any).otpStore.resolve;
                (global as any).otpStore = { resolve: null, reject: null, companyId: null, timestamp: null };
                resolve('123456');
            }, 50);

            const code = await promise;
            expect(code).toBe('123456');
        });

        it('should reject on timeout', async () => {
            const promise = waitForOtp('hapoalim', 100); // 100ms timeout

            await expect(promise).rejects.toThrow(/OTP timeout/);
        });

        it('should set companyId in the store', () => {
            waitForOtp('hapoalim', 5000).catch(() => { }); // Suppress unhandled rejection

            expect((global as any).otpStore.companyId).toBe('hapoalim');
        });

        it('should set timestamp in the store', () => {
            const before = Date.now();
            waitForOtp('hapoalim', 5000).catch(() => { });
            const after = Date.now();

            expect((global as any).otpStore.timestamp).toBeGreaterThanOrEqual(before);
            expect((global as any).otpStore.timestamp).toBeLessThanOrEqual(after);
        });

        it('should supersede previous pending OTP request', async () => {
            const first = waitForOtp('hapoalim', 5000);
            const second = waitForOtp('discount', 5000).catch(() => { });

            await expect(first).rejects.toThrow(/superseded/);
            expect((global as any).otpStore.companyId).toBe('discount');

            // Clean up second
            clearPendingOtp();
        });
    });

    describe('hasPendingOtp', () => {
        it('should return false when no OTP is pending', () => {
            expect(hasPendingOtp()).toBe(false);
        });

        it('should return true when OTP is pending', () => {
            waitForOtp('hapoalim', 5000).catch(() => { });
            expect(hasPendingOtp()).toBe(true);
        });
    });

    describe('clearPendingOtp', () => {
        it('should clear the pending OTP and reject the promise', async () => {
            const promise = waitForOtp('hapoalim', 5000);

            clearPendingOtp();

            await expect(promise).rejects.toThrow(/cancelled/);
            expect(hasPendingOtp()).toBe(false);
        });

        it('should be safe to call when no OTP is pending', () => {
            expect(() => clearPendingOtp()).not.toThrow();
        });
    });

    describe('POST /api/scrapers/otp', () => {
        it('should return 400 for missing otpCode', async () => {
            const req = { method: 'POST', body: {} };
            const res = createMockRes();

            await handler(req, res);

            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                success: false,
                message: 'OTP code is required'
            }));
        });

        it('should return 400 for empty otpCode', async () => {
            const req = { method: 'POST', body: { otpCode: '   ' } };
            const res = createMockRes();

            await handler(req, res);

            expect(res.status).toHaveBeenCalledWith(400);
        });

        it('should return 400 for non-string otpCode', async () => {
            const req = { method: 'POST', body: { otpCode: 12345 } };
            const res = createMockRes();

            await handler(req, res);

            expect(res.status).toHaveBeenCalledWith(400);
        });

        it('should return 409 when no OTP is pending', async () => {
            const req = { method: 'POST', body: { otpCode: '123456' } };
            const res = createMockRes();

            await handler(req, res);

            expect(res.status).toHaveBeenCalledWith(409);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                success: false,
                message: 'No pending OTP request'
            }));
        });

        it('should resolve pending OTP and return 200', async () => {
            const promise = waitForOtp('hapoalim', 5000);

            const req = { method: 'POST', body: { otpCode: '123456' } };
            const res = createMockRes();

            await handler(req, res);

            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                success: true
            }));

            const code = await promise;
            expect(code).toBe('123456');
        });

        it('should trim the OTP code', async () => {
            const promise = waitForOtp('hapoalim', 5000);

            const req = { method: 'POST', body: { otpCode: '  123456  ' } };
            const res = createMockRes();

            await handler(req, res);

            const code = await promise;
            expect(code).toBe('123456');
        });
    });

    describe('GET /api/scrapers/otp', () => {
        it('should return pending=false when no OTP is pending', async () => {
            const req = { method: 'GET' };
            const res = createMockRes();

            await handler(req, res);

            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                pending: false
            }));
        });

        it('should return pending=true with companyId when OTP is pending', async () => {
            waitForOtp('hapoalim', 5000).catch(() => { });

            const req = { method: 'GET' };
            const res = createMockRes();

            await handler(req, res);

            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                pending: true,
                companyId: 'hapoalim'
            }));
        });
    });

    describe('Other methods', () => {
        it('should return 405 for unsupported methods', async () => {
            const req = { method: 'PUT', body: {} };
            const res = createMockRes();

            await handler(req, res);

            expect(res.status).toHaveBeenCalledWith(405);
        });
    });
});

describe('Hapoalim OTP Handler', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        (global as any).otpStore = {
            resolve: null,
            reject: null,
            companyId: null,
            timestamp: null,
        };
    });

    afterEach(() => {
        if ((global as any).otpStore?.reject) {
            (global as any).otpStore.reject(new Error('test cleanup'));
        }
        (global as any).otpStore = {
            resolve: null,
            reject: null,
            companyId: null,
            timestamp: null,
        };
        vi.restoreAllMocks();
    });

    describe('isOtpPage', () => {
        it('should detect OTP page by URL pattern', async () => {
            const { isOtpPage } = await import('../scrapers/hapoalimOtp');

            const mockPage = {
                url: () => 'https://login.bankhapoalim.co.il/VALIDATEOTPCODE/START',
                evaluate: vi.fn()
            };

            const result = await isOtpPage(mockPage as any);
            expect(result).toBe(true);
        });

        it('should detect OTP page by Hebrew content keywords', async () => {
            const { isOtpPage } = await import('../scrapers/hapoalimOtp');

            const mockPage = {
                url: () => 'https://login.bankhapoalim.co.il/somepage',
                evaluate: vi.fn().mockResolvedValueOnce({
                    matched: true,
                    matchedKeyword: 'קוד אימות',
                    hasLoginForm: false,
                    textLength: 100,
                    textSnippet: 'הזן קוד אימות'
                }),
                frames: vi.fn().mockReturnValue([]),
            };

            const result = await isOtpPage(mockPage as any);
            expect(result).toBe(true);
        });

        it('should return false for normal pages', async () => {
            const { isOtpPage } = await import('../scrapers/hapoalimOtp');

            const mockPage = {
                url: () => 'https://login.bankhapoalim.co.il/portalserver/HomePage',
                evaluate: vi.fn().mockResolvedValue(false),
            };

            const result = await isOtpPage(mockPage as any);
            expect(result).toBe(false);
        });

        it('should handle evaluate errors gracefully', async () => {
            const { isOtpPage } = await import('../scrapers/hapoalimOtp');

            const mockPage = {
                url: () => 'https://login.bankhapoalim.co.il/somepage',
                evaluate: vi.fn().mockRejectedValue(new Error('Page not available')),
            };

            const result = await isOtpPage(mockPage as any);
            expect(result).toBe(false);
        });

        it('should detect SMS verification URL patterns', async () => {
            const { isOtpPage } = await import('../scrapers/hapoalimOtp');

            const patterns = [
                'https://login.bankhapoalim.co.il/smsVerification/page',
                'https://login.bankhapoalim.co.il/MOBILE_AUTHENTICATION/start',
                'https://login.bankhapoalim.co.il/AUTHENTICATE/OTP/validate',
            ];

            for (const url of patterns) {
                const mockPage = {
                    url: () => url,
                    evaluate: vi.fn()
                };
                const result = await isOtpPage(mockPage as any);
                expect(result).toBe(true);
            }
        });
    });

    describe('handleHapoalimOtp', () => {
        it('should emit otpRequired progress event and handle OTP timeout', async () => {
            const { handleHapoalimOtp } = await import('../scrapers/hapoalimOtp');

            const onProgress = vi.fn();
            const mockPage = createMockPuppeteerPage();

            // Use a very short timeout by mocking waitForOtp to reject quickly
            const otpMod = await import('../pages/api/scrapers/otp');

            // Make waitForOtp reject with OTP timeout immediately (avoids long retry loops)
            const spy = vi.spyOn(otpMod, 'waitForOtp').mockRejectedValue(new Error('OTP timeout'));

            const otpPromise = handleHapoalimOtp(mockPage as any, onProgress);

            await expect(otpPromise).rejects.toThrow('OTP timeout');

            // Verify progress was emitted before the timeout
            expect(onProgress).toHaveBeenCalledWith('hapoalim', expect.objectContaining({
                type: 'otpRequired'
            }));

            // Restore so subsequent tests use real waitForOtp
            spy.mockRestore();
        });

        it('should submit OTP code to separated digit inputs', async () => {
            const { handleHapoalimOtp } = await import('../scrapers/hapoalimOtp');

            const onProgress = vi.fn();
            const mockPage = createMockPuppeteerPage();

            // Create mock separated digit inputs
            const mockDigitInputs = Array.from({ length: 5 }, () => ({
                click: vi.fn().mockResolvedValue(undefined),
                type: vi.fn().mockResolvedValue(undefined),
                press: vi.fn().mockResolvedValue(undefined),
                boundingBox: vi.fn().mockResolvedValue({ x: 0, y: 0, width: 40, height: 40 }),
            }));

            // Track whether OTP has been submitted to switch $$ behavior
            let otpSubmitted = false;

            // $$ returns separated inputs when queried with the right selector
            mockPage.$$.mockImplementation((selector: string) => {
                if (selector === 'input[data-testid^="separated-"]') {
                    return Promise.resolve(otpSubmitted ? [] : mockDigitInputs);
                }
                return Promise.resolve([]);
            });

            // After OTP, page goes to homepage
            let urlAfterOtp = 'https://login.bankhapoalim.co.il/otp-page';
            mockPage.url.mockImplementation(() => urlAfterOtp);
            // evaluate: DOM traversal button click returns true
            mockPage.evaluate.mockResolvedValue(true);

            // Start OTP handling
            const otpPromise = handleHapoalimOtp(mockPage as any, onProgress);

            // Wait a bit for waitForOtp to be set up
            await new Promise(resolve => setTimeout(resolve, 100));

            // Submit the code
            const resolveOtp = (global as any).otpStore.resolve;
            expect(resolveOtp).not.toBeNull();

            (global as any).otpStore.resolve = null;
            (global as any).otpStore.reject = null;
            resolveOtp('65432');

            // Wait for the code to be typed before switching the URL/inputs
            await new Promise(resolve => setTimeout(resolve, 2000));

            // Simulate URL change and input disappearance after OTP submission
            urlAfterOtp = 'https://login.bankhapoalim.co.il/ng-portals/rb/he/homepage';
            otpSubmitted = true;

            const result = await otpPromise;
            expect(result).toBe(true);
            // Verify each digit was typed into its input
            for (let i = 0; i < 5; i++) {
                expect(mockDigitInputs[i].click).toHaveBeenCalled();
                expect(mockDigitInputs[i].type).toHaveBeenCalledWith('65432'[i], expect.any(Object));
            }
        }, 30000);
    });
});

// Helper to create mock response object
function createMockRes() {
    const res: any = {};
    res.status = vi.fn().mockReturnValue(res);
    res.json = vi.fn().mockReturnValue(res);
    return res;
}

// Helper to create a mock Puppeteer page
function createMockPuppeteerPage() {
    const mainFrame = { url: () => 'main' };
    const page: any = {
        url: vi.fn().mockReturnValue('https://login.bankhapoalim.co.il/some-page'),
        evaluate: vi.fn().mockResolvedValue(false),
        evaluateHandle: vi.fn().mockResolvedValue({ asElement: () => null }),
        $: vi.fn().mockResolvedValue(null),
        $$: vi.fn().mockResolvedValue([]),
        click: vi.fn().mockResolvedValue(undefined),
        type: vi.fn().mockResolvedValue(undefined),
        keyboard: {
            press: vi.fn().mockResolvedValue(undefined)
        },
        waitForNavigation: vi.fn().mockResolvedValue(undefined),
        waitForFunction: vi.fn().mockResolvedValue(undefined),
        screenshot: vi.fn().mockResolvedValue(undefined),
        mainFrame: vi.fn().mockReturnValue(mainFrame),
        frames: vi.fn().mockReturnValue([mainFrame]),
        isClosed: vi.fn().mockReturnValue(false),
    };
    return page;
}
