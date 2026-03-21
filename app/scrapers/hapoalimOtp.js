/**
 * Custom Hapoalim Scraper with 2FA/OTP support
 * 
 * Bank Hapoalim requires SMS-based 2FA (OTP) verification after login.
 * The standard israeli-bank-scrapers library doesn't handle this case.
 * 
 * This custom scraper:
 * 1. Detects the OTP verification page after login submission
 * 2. Emits a progress event to the UI asking for the OTP code
 * 3. Waits for the user to submit the OTP code via the /api/scrapers/otp endpoint
 * 4. Types the OTP into the bank's verification form and submits it
 * 5. Continues with normal scraping after successful verification
 */

import { createScraper } from 'israeli-bank-scrapers';
import { waitForOtp, clearPendingOtp } from '../pages/api/scrapers/otp.js';
import logger from '../utils/logger.js';

// Known OTP page URL patterns for Bank Hapoalim   
const OTP_PAGE_PATTERNS = [
    /VALIDATEOTPCODE/i,
    /AUTHENTICATE.*OTP/i,
    /OTP.*VALIDATE/i,
    /smsVerification/i,
    /mobileVerification/i,
    /twoFactorAuth/i,
    /secondFactor/i,
    /MOBILE_AUTHENTICATION/i,
    /ng-portals\/auth/i,          // Hapoalim auth page (OTP may appear here without redirect)
    /ng-portals-bt\/auth/i,       // Alternative auth page path
];

// Hebrew and English OTP keywords to search in page content
const OTP_KEYWORDS = [
    'קוד אימות',        // Verification code
    'קוד חד פעמי',      // One-time code
    'הזן את הקוד',      // Enter the code
    'שלחנו קוד',        // We sent a code
    'קוד sms',          // SMS code
    'אימות דו שלבי',    // Two-factor authentication
    'הקלד את הקוד',     // Type the code
    'קוד זמני',         // Temporary code
    'אימות נוסף',       // Additional verification
    'הזדהות',           // Authentication/Identification
    'אמצעי זיהוי',      // Identification method  
    'הודעת sms',        // SMS message
    'verification code',
    'enter the code',
    'one-time password',
    'sms code',
    'enter otp',
];

// Hapoalim uses separated single-digit inputs with data-testid="separated-N"
const SEPARATED_OTP_SELECTOR = 'input[data-testid^="separated-"]';

// Known OTP input selectors on Hapoalim's 2FA page
const OTP_INPUT_SELECTORS = [
    SEPARATED_OTP_SELECTOR,
    'input[name="otpCode"]',
    'input[name="code"]',
    'input[name="otp"]',
    'input[id*="otp"]',
    'input[id*="Otp"]',
    'input[id*="OTP"]',
    'input[id*="code"]',
    'input[id*="Code"]',
    'input[id*="sms"]',
    'input[id*="Sms"]',
    'input[id*="pin"]',
    'input[id*="Pin"]',
    'input[type="tel"]',
    'input[type="number"][maxlength]',
    'input.otp-input',
    'input.code-input',
    'input.sms-code',
    'input[autocomplete="one-time-code"]',
];

// Known OTP submit button selectors
const OTP_SUBMIT_SELECTORS = [
    'button.btn-red_1',           // Hapoalim's "המשך" button
    'button[type="submit"]',
    'button.submit-btn',
    'button.otp-submit',
    'button.confirm-btn',
    'input[type="submit"]',
    '.login-btn',
    'button:not([disabled])',
];

/**
 * Detect if the current page is an OTP verification page.
 * Uses multiple strategies: URL patterns, page text content (innerText + innerHTML),
 * presence of OTP input fields, and iframe content.
 */
async function isOtpPage(page) {
    const url = page.url();
    logger.info({ url }, '[Hapoalim OTP] Checking if page is OTP page');

    // Strategy 1: Check URL patterns
    const urlMatch = OTP_PAGE_PATTERNS.some(pattern => pattern.test(url));
    if (urlMatch) {
        // URL matched but for auth pages, we also need content confirmation
        // since the auth page is also the regular login page
        const isAuthPage = /ng-portals.*\/auth/i.test(url);
        if (!isAuthPage) {
            logger.info('[Hapoalim OTP] URL directly matches OTP pattern (non-auth URL)');
            return true;
        }
        // For auth pages, fall through to content checks
        logger.info('[Hapoalim OTP] URL matches auth pattern, checking content for OTP indicators...');
    }

    // Strategy 2: Check page content using innerText (visible text)
    try {
        const textCheckResult = await page.evaluate((keywords) => {
            const bodyText = (document.body?.innerText || '').toLowerCase();
            const matchedKeyword = keywords.find(keyword => bodyText.includes(keyword.toLowerCase()));
            // Also check if the login form is still visible (which would mean it's NOT an OTP page)
            const hasLoginForm = !!document.querySelector('#userCode, #password, input[name="userCode"]');
            return {
                matched: !!matchedKeyword,
                matchedKeyword: matchedKeyword || null,
                hasLoginForm,
                textLength: bodyText.length,
                textSnippet: bodyText.substring(0, 300)
            };
        }, OTP_KEYWORDS);

        logger.info({
            matched: textCheckResult.matched,
            matchedKeyword: textCheckResult.matchedKeyword,
            hasLoginForm: textCheckResult.hasLoginForm,
            textLength: textCheckResult.textLength,
            textSnippet: textCheckResult.textSnippet
        }, '[Hapoalim OTP] innerText content check result');

        if (textCheckResult.matched && !textCheckResult.hasLoginForm) {
            logger.info('[Hapoalim OTP] OTP detected via page innerText');
            return true;
        }
    } catch (err) {
        logger.warn({ error: err.message }, '[Hapoalim OTP] Error checking innerText');
    }

    // Strategy 3: Check innerHTML (catches text in attributes, hidden elements, etc.)
    try {
        const htmlCheckResult = await page.evaluate((keywords) => {
            const html = (document.body?.innerHTML || '').toLowerCase();
            const matchedKeyword = keywords.find(keyword => html.includes(keyword.toLowerCase()));
            return { matched: !!matchedKeyword, matchedKeyword: matchedKeyword || null };
        }, OTP_KEYWORDS);

        if (htmlCheckResult.matched) {
            logger.info({ keyword: htmlCheckResult.matchedKeyword }, '[Hapoalim OTP] OTP detected via innerHTML');
            return true;
        }
    } catch (err) {
        logger.warn({ error: err.message }, '[Hapoalim OTP] Error checking innerHTML');
    }

    // Strategy 4: Check for OTP-like input fields (the most reliable indicator)
    try {
        const inputCheckResult = await page.evaluate((selectors) => {
            for (const selector of selectors) {
                const el = document.querySelector(selector);
                if (el) {
                    const rect = el.getBoundingClientRect();
                    // Check if the element is visible (has dimensions)
                    if (rect.width > 0 && rect.height > 0) {
                        return { found: true, selector, visible: true };
                    }
                    return { found: true, selector, visible: false };
                }
            }
            // Fallback: look for any short text/tel/number input that could be an OTP field
            const inputs = document.querySelectorAll('input[type="text"], input[type="tel"], input[type="number"], input:not([type])');
            for (const input of inputs) {
                const maxLen = input.maxLength || input.getAttribute('maxlength');
                if (maxLen && parseInt(maxLen) <= 8 && parseInt(maxLen) >= 4) {
                    const rect = input.getBoundingClientRect();
                    if (rect.width > 0 && rect.height > 0) {
                        return { found: true, selector: `input(maxlength=${maxLen})`, visible: true, fallback: true };
                    }
                }
            }
            return { found: false };
        }, OTP_INPUT_SELECTORS);

        logger.info(inputCheckResult, '[Hapoalim OTP] Input field check result');

        // If we found an OTP input AND the login form is gone, it's likely an OTP page
        if (inputCheckResult.found && inputCheckResult.visible) {
            // Double-check: make sure we're NOT on the initial login page
            const isLoginPage = await page.evaluate(() => {
                return !!document.querySelector('#userCode') && !!document.querySelector('#password');
            });
            if (!isLoginPage) {
                logger.info('[Hapoalim OTP] OTP detected via input field presence (no login form)');
                return true;
            }
        }
    } catch (err) {
        logger.warn({ error: err.message }, '[Hapoalim OTP] Error checking input fields');
    }

    // Strategy 5: Check iframes (bank might render OTP in an iframe)
    try {
        const frames = page.frames();
        for (const frame of frames) {
            if (frame === page.mainFrame()) continue;
            try {
                const frameUrl = frame.url();
                if (OTP_PAGE_PATTERNS.some(pattern => pattern.test(frameUrl))) {
                    logger.info({ frameUrl }, '[Hapoalim OTP] OTP detected in iframe URL');
                    return true;
                }
                const frameHasOtp = await frame.evaluate((keywords) => {
                    const text = (document.body?.innerText || '').toLowerCase();
                    return keywords.some(k => text.includes(k.toLowerCase()));
                }, OTP_KEYWORDS);
                if (frameHasOtp) {
                    logger.info({ frameUrl }, '[Hapoalim OTP] OTP detected in iframe content');
                    return true;
                }
            } catch {
                // Frame may be cross-origin, skip
            }
        }
    } catch (err) {
        logger.warn({ error: err.message }, '[Hapoalim OTP] Error checking iframes');
    }

    logger.info('[Hapoalim OTP] No OTP indicators found on page');
    return false;
}

/**
 * Find separated OTP digit inputs (e.g. data-testid="separated-0" through "separated-N")
 * Hapoalim uses this pattern: one input per digit, each with data-testid="separated-N"
 * @returns {Promise<{elements: ElementHandle[], frame: Frame}|null>}
 */
async function findSeparatedOtpInputs(page) {
    const checkContext = async (context) => {
        try {
            const elements = await context.$$(SEPARATED_OTP_SELECTOR);
            if (elements.length >= 4) {
                // Verify at least the first one is visible
                const box = await elements[0].boundingBox();
                if (box) {
                    return elements;
                }
            }
        } catch { /* ignore */ }
        return null;
    };

    // Check main page
    const mainResult = await checkContext(page);
    if (mainResult) {
        logger.info({ count: mainResult.length }, '[Hapoalim OTP] Found separated OTP inputs on main page');
        return { elements: mainResult, frame: page };
    }

    // Check iframes
    for (const frame of page.frames()) {
        if (frame === page.mainFrame()) continue;
        const frameResult = await checkContext(frame);
        if (frameResult) {
            logger.info({ count: frameResult.length, frameUrl: frame.url() }, '[Hapoalim OTP] Found separated OTP inputs in iframe');
            return { elements: frameResult, frame };
        }
    }

    return null;
}

/**
 * Find a single OTP input field on the page or in iframes
 * @returns {Promise<{element: ElementHandle, frame: Frame}|null>}
 */
async function findOtpInput(page) {
    // Skip the separated selector here — it's handled by findSeparatedOtpInputs
    const singleSelectors = OTP_INPUT_SELECTORS.filter(s => s !== SEPARATED_OTP_SELECTOR);

    // Try main page first
    for (const selector of singleSelectors) {
        try {
            const element = await page.$(selector);
            if (element) {
                const isVisible = await element.boundingBox();
                if (isVisible) {
                    logger.info({ selector }, '[Hapoalim OTP] Found OTP input on main page');
                    return { element, frame: page };
                }
            }
        } catch { /* ignore */ }
    }

    // Try all frames
    for (const frame of page.frames()) {
        if (frame === page.mainFrame()) continue;
        for (const selector of singleSelectors) {
            try {
                const element = await frame.$(selector);
                if (element) {
                    const isVisible = await element.boundingBox();
                    if (isVisible) {
                        logger.info({ selector, frameUrl: frame.url() }, '[Hapoalim OTP] Found OTP input in iframe');
                        return { element, frame };
                    }
                }
            } catch { /* ignore */ }
        }
    }

    // Fallback: Look for any visible numeric/tel input
    try {
        const result = await page.evaluateHandle(() => {
            const inputs = Array.from(document.querySelectorAll('input'));
            return inputs.find(input => {
                // Check if visible
                const rect = input.getBoundingClientRect();
                if (rect.width === 0 || rect.height === 0) return false;

                // Check attributes
                const type = (input.type || '').toLowerCase();
                const name = (input.name || '').toLowerCase();
                const id = (input.id || '').toLowerCase();
                const autocomplete = (input.autocomplete || '').toLowerCase();

                if (autocomplete.includes('one-time-code')) return true;
                if (name.includes('otp') || name.includes('code') || id.includes('otp') || id.includes('code')) return true;
                if ((type === 'tel' || type === 'number') && input.maxLength > 0 && input.maxLength < 10) return true;

                return false;
            });
        });

        if (result && result.asElement()) {
            logger.info('[Hapoalim OTP] Found OTP input via properties fallback');
            return { element: result.asElement(), frame: page };
        }
    } catch (err) {
        logger.warn({ error: err.message }, '[Hapoalim OTP] Error in fallback input search');
    }

    return null;
}

/**
 * Check if any OTP input (separated or single) is still visible on the page
 */
async function isOtpInputVisible(page) {
    const separated = await findSeparatedOtpInputs(page);
    if (separated) return true;
    const single = await findOtpInput(page);
    return !!single;
}

/**
 * Find the OTP submit button on the page or in iframes
 * @returns {Promise<{element: ElementHandle, frame: Frame}|null>}
 */
async function findOtpSubmitButton(page) {
    // Helper to check element
    const checkElement = async (context) => {
        for (const selector of OTP_SUBMIT_SELECTORS) {
            try {
                const elements = await context.$$(selector);
                for (const element of elements) {
                    const box = await element.boundingBox();
                    if (box) {
                        return { element, selector };
                    }
                }
            } catch { /* ignore */ }
        }
        return null;
    };

    // Check main page
    const mainPageResult = await checkElement(page);
    if (mainPageResult) {
        logger.info({ selector: mainPageResult.selector }, '[Hapoalim OTP] Found OTP submit button on main page');
        return { element: mainPageResult.element, frame: page };
    }

    // Check frames
    for (const frame of page.frames()) {
        if (frame === page.mainFrame()) continue;
        const frameResult = await checkElement(frame);
        if (frameResult) {
            logger.info({ selector: frameResult.selector, frameUrl: frame.url() }, '[Hapoalim OTP] Found OTP submit button in iframe');
            return { element: frameResult.element, frame };
        }
    }

    return null;
}

// Helper to take debug screenshots
async function takeDebugScreenshot(page, name) {
    try {
        const path = `/tmp/hapoalim_otp_${name}.png`;
        await page.screenshot({ path, fullPage: true });
        logger.info({ path }, `[Hapoalim OTP] Saved debug screenshot: ${name}`);
    } catch (e) {
        logger.warn({ error: e.message }, `[Hapoalim OTP] Failed to save screenshot: ${name}`);
    }
}

/**
 * Handle the OTP verification flow for Bank Hapoalim
 * @param {Page} page - Puppeteer page instance
 * @param {Function} onProgress - Progress callback
 * @returns {boolean} Whether OTP verification was successful 
 */
export async function handleHapoalimOtp(page, onProgress) {
    logger.info('[Hapoalim OTP] Detected 2FA/OTP verification page');
    await takeDebugScreenshot(page, 'detected');

    // Notify the frontend that OTP is required
    if (onProgress) {
        onProgress('hapoalim', {
            type: 'otpRequired',
            message: 'Bank Hapoalim requires 2FA verification. Please enter the SMS code sent to your phone.',
        });
    }

    let attempts = 0;
    const MAX_ATTEMPTS = 3;

    while (attempts < MAX_ATTEMPTS) {
        try {
            // Wait for the user to submit the OTP code via the API
            logger.info(`[Hapoalim OTP] Waiting for user to submit OTP code (Attempt ${attempts + 1}/${MAX_ATTEMPTS})...`);

            // Wait for code - huge timeout to allow user interaction
            const otpCode = await waitForOtp('hapoalim', 300000); // 5 minute timeout

            logger.info({ codeLength: otpCode.length }, '[Hapoalim OTP] OTP code received from user');

            // Notify frontend
            if (onProgress) {
                onProgress('hapoalim', {
                    type: 'otpSubmitting',
                    message: 'Submitting verification code...',
                });
            }

            // Try separated inputs first (Hapoalim's actual pattern: one input per digit)
            let usedSeparated = false;
            let separatedObj = null;
            for (let i = 0; i < 5; i++) {
                separatedObj = await findSeparatedOtpInputs(page);
                if (separatedObj) break;
                await new Promise(r => setTimeout(r, 1000));
            }

            if (separatedObj) {
                usedSeparated = true;
                const { elements, frame: inputFrame } = separatedObj;
                const digits = otpCode.split('');
                logger.info({ digitCount: digits.length, inputCount: elements.length }, '[Hapoalim OTP] Typing digits into separated inputs');

                for (let i = 0; i < Math.min(digits.length, elements.length); i++) {
                    try {
                        await elements[i].click();
                        await new Promise(r => setTimeout(r, 50));
                        await elements[i].type(digits[i], { delay: 50 });
                    } catch (e) {
                        logger.warn({ index: i, error: e.message }, '[Hapoalim OTP] Standard type failed for digit, using evaluate');
                        await inputFrame.evaluate((el, digit) => {
                            el.value = digit;
                            el.dispatchEvent(new Event('input', { bubbles: true }));
                            el.dispatchEvent(new Event('change', { bubbles: true }));
                        }, elements[i], digits[i]);
                    }
                    await new Promise(r => setTimeout(r, 100));
                }
            } else {
                // Fallback: try single input field
                let inputObj = null;
                for (let i = 0; i < 5; i++) {
                    inputObj = await findOtpInput(page);
                    if (inputObj) break;
                    await new Promise(r => setTimeout(r, 1000));
                }

                if (!inputObj) {
                    logger.error('[Hapoalim OTP] Could not find OTP input field on the page');
                    await takeDebugScreenshot(page, 'input-not-found');

                    const isStillOtp = await isOtpPage(page);
                    if (!isStillOtp) {
                        logger.info('[Hapoalim OTP] Input not found but page is no longer OTP page? Assuming success.');
                        return true;
                    }

                    throw new Error('Could not find OTP input field on the verification page');
                }

                const { element: inputElement, frame: inputFrame } = inputObj;

                try {
                    await inputElement.click({ clickCount: 3 });
                    await inputElement.type(otpCode, { delay: 100 });
                } catch (e) {
                    logger.warn({ error: e.message }, '[Hapoalim OTP] Standard type failed, trying evaluate');
                    await inputFrame.evaluate((el, code) => { el.value = code; el.dispatchEvent(new Event('input', { bubbles: true })); }, inputElement, otpCode);
                }
            }

            // Small delay before submitting
            await new Promise(resolve => setTimeout(resolve, 800));

            // Find and click the submit button
            let clicked = false;

            // For separated inputs, try clicking the nearby submit button via DOM traversal first
            if (usedSeparated) {
                try {
                    clicked = await page.evaluate(() => {
                        // Find the container with the separated inputs
                        const otpInput = document.querySelector('input[data-testid^="separated-"]');
                        if (!otpInput) return false;

                        // Walk up to find the form/dialog container, then find the submit button within it
                        let container = otpInput.closest('form') || otpInput.closest('[role="dialog"]') || otpInput.closest('.modal-content') || otpInput.closest('[class*="modal"]');
                        // If no container found, try broader traversal
                        if (!container) {
                            container = otpInput.parentElement;
                            // Walk up a few levels to find a container with a button
                            for (let i = 0; i < 10 && container; i++) {
                                if (container.querySelector('button.btn-red_1, button[type="submit"]')) break;
                                container = container.parentElement;
                            }
                        }
                        if (!container) return false;

                        const btn = container.querySelector('button.btn-red_1') || container.querySelector('button[type="submit"]');
                        if (btn) {
                            btn.click();
                            return true;
                        }
                        return false;
                    });
                    if (clicked) {
                        logger.info('[Hapoalim OTP] Clicked OTP submit button via DOM traversal');
                    }
                } catch (e) {
                    logger.warn({ error: e.message }, '[Hapoalim OTP] DOM traversal button click failed');
                }
            }

            if (!clicked) {
                const submitObj = await findOtpSubmitButton(page);
                if (submitObj) {
                    await submitObj.element.click();
                    clicked = true;
                    logger.info('[Hapoalim OTP] Clicked OTP submit button');
                } else {
                    // Last resort: press Enter on the last digit input
                    logger.info('[Hapoalim OTP] No submit button found, pressing Enter');
                    if (usedSeparated && separatedObj) {
                        const lastInput = separatedObj.elements[separatedObj.elements.length - 1];
                        await lastInput.press('Enter');
                    } else {
                        const fallbackInput = await findOtpInput(page);
                        if (fallbackInput) await fallbackInput.element.press('Enter');
                    }
                }
            }

            // Wait for navigation or change after OTP submission
            logger.info('[Hapoalim OTP] Waiting for navigation/change...');

            // Wait for either navigation or input disappearance
            try {
                await Promise.race([
                    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }),
                    page.waitForFunction(() => !document.querySelector('input[data-testid^="separated-"]'), { timeout: 15000 }),
                    new Promise(resolve => setTimeout(resolve, 5000))
                ]);
            } catch (e) {
                // Ignore timeouts here, we check state explicitly below
            }

            // Let page settle
            await new Promise(resolve => setTimeout(resolve, 2000));
            await takeDebugScreenshot(page, `attempt-${attempts + 1}-result`);

            // Check if successful
            const currentUrl = page.url();
            const isSuccessUrl = currentUrl.toLowerCase().includes('homepage') ||
                currentUrl.toLowerCase().includes('portalserver');

            // Check if input is gone (strong indicator of success or at least processing)
            const inputStillVisible = await isOtpInputVisible(page);

            if (isSuccessUrl || !inputStillVisible) {
                logger.info('[Hapoalim OTP] OTP verification successful (URL changed or input gone)');
                if (onProgress) {
                    onProgress('hapoalim', {
                        type: 'otpSuccess',
                        message: '✓ 2FA verification successful',
                    });
                }
                return true;
            }

            // If we are here, we are likely still on the OTP page with visible input
            logger.warn(`[Hapoalim OTP] Attempt ${attempts + 1} failed - still on OTP page`);

            // Check for specific error messages
            const errorMessage = await page.evaluate(() => {
                const errorEl = document.querySelector('.error-message, .alert-danger, .validation-summary-errors, [class*="error"]');
                return errorEl ? errorEl.innerText : null;
            });

            if (errorMessage) {
                logger.info({ errorMessage }, '[Hapoalim OTP] Found error message on page');
            }

            attempts++;

            if (attempts < MAX_ATTEMPTS) {
                if (onProgress) {
                    onProgress('hapoalim', {
                        type: 'otpFailed',
                        message: errorMessage || 'Verification failed. Please check the code and try again.',
                    });
                }
                // Loop continues, waitForOtp will be called again
            } else {
                throw new Error('Max OTP attempts reached');
            }

        } catch (error) {
            logger.error({ error: error.message }, '[Hapoalim OTP] OTP attempt failed');

            // If it's a timeout waiting for user, we abort
            if (error.message.includes('OTP timeout')) {
                throw error;
            }

            attempts++;
            if (attempts >= MAX_ATTEMPTS) {
                clearPendingOtp();
                if (onProgress) {
                    onProgress('hapoalim', {
                        type: 'otpFailed',
                        message: `2FA verification failed: ${error.message}`,
                    });
                }
                throw error;
            } else {
                if (onProgress) {
                    onProgress('hapoalim', {
                        type: 'otpFailed',
                        message: 'Something went wrong. Please try again.',
                    });
                }
            }
        }
    }

    return false;
}

export { isOtpPage };
export default { handleHapoalimOtp, isOtpPage, waitForOtp, clearPendingOtp };
