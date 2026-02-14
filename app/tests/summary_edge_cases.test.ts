import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generateDailySummary } from '../utils/summary.js';
import { getDB } from '../pages/api/db.js';
import { GoogleGenerativeAI } from "@google/generative-ai";

vi.mock('../pages/api/db.js', () => ({
    getDB: vi.fn(),
}));

vi.mock('@google/generative-ai', () => {
    const generateContentMock = vi.fn().mockResolvedValue({
        response: {
            text: () => "AI Summary",
            candidates: [{ finishReason: 'STOP', safetyRatings: [] }]
        }
    });
    const getGenerativeModelMock = vi.fn().mockReturnValue({
        generateContent: generateContentMock
    });
    return {
        GoogleGenerativeAI: vi.fn().mockImplementation(() => ({
            getGenerativeModel: getGenerativeModelMock
        }))
    };
});

vi.mock('../utils/logger.js', () => ({
    default: { info: vi.fn(), error: vi.fn(), warn: vi.fn() }
}));

/**
 * Helper to access the most recent generateContent call's prompt.
 * Uses the latest mock results/calls (not index 0) since mocks accumulate across tests.
 */
function getPromptFromLastCall(): string {
    const results = (GoogleGenerativeAI as any).mock.results;
    const genAiInstance = results[results.length - 1].value;
    const modelResults = genAiInstance.getGenerativeModel.mock.results;
    const modelInstance = modelResults[modelResults.length - 1].value;
    const calls = modelInstance.generateContent.mock.calls;
    return calls[calls.length - 1][0];
}

/**
 * Helper to get the generateContent mock for configuring rejections before a call.
 */
function getGenerateContentMock() {
    const results = (GoogleGenerativeAI as any).mock.results;
    // If no results yet, create a temporary instance to access the shared mock
    if (results.length === 0) {
        const instance = new (GoogleGenerativeAI as any)('dummy');
        const model = instance.getGenerativeModel({ model: 'test' });
        return model.generateContent;
    }
    const genAiInstance = results[results.length - 1].value;
    const modelResults = genAiInstance.getGenerativeModel.mock.results;
    const modelInstance = modelResults[modelResults.length - 1].value;
    return modelInstance.generateContent;
}

describe('Summary Generation', () => {
    let mockClient: any;

    beforeEach(() => {
        // Don't use vi.clearAllMocks() — it wipes mockImplementation on GoogleGenerativeAI
        mockClient = {
            query: vi.fn(),
            release: vi.fn()
        };
        (getDB as any).mockResolvedValue(mockClient);
    });

    function setupDefaultSettings(overrides: Record<string, string> = {}) {
        const defaults: Record<string, string> = {
            gemini_api_key: '"test-key"',
            gemini_model: '"gemini-2.5-flash"',
            whatsapp_summary_mode: '"calendar"',
            billing_cycle_start_day: '10',
            ...overrides
        };
        return {
            rows: Object.entries(defaults).map(([key, value]) => ({ key, value }))
        };
    }

    it('should calculate burndown rate and construct prompt correctly', async () => {
        mockClient.query.mockResolvedValueOnce(setupDefaultSettings());
        mockClient.query.mockResolvedValueOnce({
            rows: [
                { date: '2026-01-20', name: 'Test Shop', category: 'Food', price: 100, vendor: 'Visa' }
            ]
        });
        mockClient.query.mockResolvedValueOnce({
            rows: [{ category: 'Food', budget_limit: 1000 }]
        });
        mockClient.query.mockResolvedValueOnce({
            rows: [
                { category: 'Food', actual_spent: 200 },
                { category: 'Unbudgeted', actual_spent: 50 }
            ]
        });
        mockClient.query.mockResolvedValueOnce({
            rows: [{ budget_limit: 5000 }]
        });

        const result = await generateDailySummary();
        expect(result).toBe("AI Summary");

        const prompt = getPromptFromLastCall();
        expect(prompt).toContain('💰 *סיכום הוצאות יומי* 💰');
        expect(prompt).toContain('1️⃣ *10 עסקאות אחרונות');
        expect(prompt).toContain('חובה להציג את כל 10 העסקאות');
        expect(prompt).toContain('2️⃣ *סטטוס תקציב לפי קטגוריות');
        expect(prompt).toContain('3️⃣ *תמונת מצב תקציב כולל');
        expect(prompt).toContain('• *תקציב:* ₪5000');
        expect(prompt).toContain('*Food:* ₪200/₪1000');
        expect(prompt).not.toContain('Unbudgeted:');
        expect(prompt).toContain('20.01: Test Shop - ₪100 (Food)');
    });

    it('should throw when Gemini API key is not configured', async () => {
        mockClient.query.mockResolvedValueOnce({
            rows: [
                { key: 'whatsapp_summary_mode', value: '"calendar"' },
                { key: 'billing_cycle_start_day', value: '10' }
            ]
        });

        const savedKey = process.env.GEMINI_API_KEY;
        delete process.env.GEMINI_API_KEY;

        await expect(generateDailySummary()).rejects.toThrow('Gemini API key not configured');
        expect(mockClient.release).toHaveBeenCalledTimes(1);

        process.env.GEMINI_API_KEY = savedKey;
    });

    it('should handle zero transactions in period', async () => {
        mockClient.query.mockResolvedValueOnce(setupDefaultSettings());
        mockClient.query.mockResolvedValueOnce({ rows: [] });
        mockClient.query.mockResolvedValueOnce({ rows: [{ category: 'Food', budget_limit: 1000 }] });
        mockClient.query.mockResolvedValueOnce({ rows: [] });
        mockClient.query.mockResolvedValueOnce({ rows: [{ budget_limit: 5000 }] });

        const result = await generateDailySummary();
        expect(result).toBe("AI Summary");

        const prompt = getPromptFromLastCall();
        expect(prompt).toContain('💰 *סיכום הוצאות יומי* 💰');
        expect(prompt).toContain('₪0/₪1000');
        expect(prompt).toContain('*הוצאות:* ₪0');
    });

    it('should handle all categories over budget', async () => {
        mockClient.query.mockResolvedValueOnce(setupDefaultSettings());
        mockClient.query.mockResolvedValueOnce({
            rows: [{ date: '2024-01-20', name: 'Store', category: 'Food', price: 500, vendor: 'visaCal' }]
        });
        mockClient.query.mockResolvedValueOnce({
            rows: [
                { category: 'Food', budget_limit: 100 },
                { category: 'Transport', budget_limit: 200 }
            ]
        });
        mockClient.query.mockResolvedValueOnce({
            rows: [
                { category: 'Food', actual_spent: 500 },
                { category: 'Transport', actual_spent: 400 }
            ]
        });
        mockClient.query.mockResolvedValueOnce({ rows: [{ budget_limit: 300 }] });

        const result = await generateDailySummary();
        expect(result).toBe("AI Summary");

        const prompt = getPromptFromLastCall();
        expect(prompt).toContain('⚠️ חריגה!');
        expect(prompt).toContain('*Food:*');
        expect(prompt).toContain('*Transport:*');
    });

    it('should handle missing total budget', async () => {
        mockClient.query.mockResolvedValueOnce(setupDefaultSettings());
        mockClient.query.mockResolvedValueOnce({ rows: [] });
        mockClient.query.mockResolvedValueOnce({ rows: [] });
        mockClient.query.mockResolvedValueOnce({
            rows: [{ category: 'Food', actual_spent: 100 }]
        });
        mockClient.query.mockResolvedValueOnce({ rows: [] });

        const result = await generateDailySummary();
        expect(result).toBe("AI Summary");

        const prompt = getPromptFromLastCall();
        expect(prompt).toContain('*תקציב:* ₪0');
        expect(prompt).not.toContain('מצוין ✅');
    });

    it('should use billing cycle mode when configured', async () => {
        mockClient.query.mockResolvedValueOnce(
            setupDefaultSettings({ whatsapp_summary_mode: '"cycle"' })
        );
        mockClient.query.mockResolvedValueOnce({ rows: [] });
        mockClient.query.mockResolvedValueOnce({ rows: [] });
        mockClient.query.mockResolvedValueOnce({ rows: [] });
        mockClient.query.mockResolvedValueOnce({ rows: [{ budget_limit: 5000 }] });

        const result = await generateDailySummary();
        expect(result).toBe("AI Summary");

        // The actual SQL query for cycle mode uses effective_billing_month
        const actualQuery = mockClient.query.mock.calls[3];
        const [, params] = actualQuery;
        // Cycle mode should use a single param (YYYY-MM format)
        expect(params).toHaveLength(1);
        expect(params[0]).toMatch(/^\d{4}-\d{2}$/);
    });

    it('should release client even when Gemini throws', async () => {
        // Configure the generateContent mock to reject before the call
        const gcMock = getGenerateContentMock();
        gcMock.mockRejectedValueOnce(new Error('Rate limit exceeded'));

        mockClient.query.mockResolvedValueOnce(setupDefaultSettings());
        mockClient.query.mockResolvedValueOnce({ rows: [] });
        mockClient.query.mockResolvedValueOnce({ rows: [] });
        mockClient.query.mockResolvedValueOnce({ rows: [] });
        mockClient.query.mockResolvedValueOnce({ rows: [] });

        await expect(generateDailySummary()).rejects.toThrow('Rate limit exceeded');
        expect(mockClient.release).toHaveBeenCalledTimes(1);
    });

    it('should use env GEMINI_API_KEY as fallback when not in settings', async () => {
        const savedKey = process.env.GEMINI_API_KEY;
        process.env.GEMINI_API_KEY = 'env-api-key';

        mockClient.query.mockResolvedValueOnce({
            rows: [
                { key: 'whatsapp_summary_mode', value: '"calendar"' },
                { key: 'billing_cycle_start_day', value: '10' }
            ]
        });
        mockClient.query.mockResolvedValueOnce({ rows: [] });
        mockClient.query.mockResolvedValueOnce({ rows: [] });
        mockClient.query.mockResolvedValueOnce({ rows: [] });
        mockClient.query.mockResolvedValueOnce({ rows: [] });

        const result = await generateDailySummary();
        expect(result).toBe("AI Summary");

        expect(GoogleGenerativeAI).toHaveBeenCalledWith('env-api-key');

        process.env.GEMINI_API_KEY = savedKey;
    });

    it('should exclude unbudgeted categories from budget status', async () => {
        mockClient.query.mockResolvedValueOnce(setupDefaultSettings());
        mockClient.query.mockResolvedValueOnce({ rows: [] });
        mockClient.query.mockResolvedValueOnce({
            rows: [{ category: 'Food', budget_limit: 1000 }]
        });
        mockClient.query.mockResolvedValueOnce({
            rows: [
                { category: 'Food', actual_spent: 300 },
                { category: 'Shopping', actual_spent: 500 }
            ]
        });
        mockClient.query.mockResolvedValueOnce({ rows: [{ budget_limit: 5000 }] });

        const result = await generateDailySummary();
        expect(result).toBe("AI Summary");

        const prompt = getPromptFromLastCall();
        expect(prompt).toContain('*Food:* ₪300/₪1000');
        expect(prompt).not.toContain('*Shopping:*');
    });
});
