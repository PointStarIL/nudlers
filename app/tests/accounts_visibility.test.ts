import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getDB } from '../pages/api/db';
import indexHandler from '../pages/api/accounts/index';
import detailHandler from '../pages/api/accounts/[id]';

// Mock the database module
vi.mock('../pages/api/db', () => ({
    getDB: vi.fn()
}));

// Mock the logger
vi.mock('../utils/logger.js', () => ({
    default: {
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn()
    }
}));

describe('Accounts API', () => {
    let mockClient: any;
    let mockReq: any;
    let mockRes: any;

    beforeEach(() => {
        vi.clearAllMocks();

        mockClient = {
            query: vi.fn(),
            release: vi.fn()
        };

        (getDB as any).mockResolvedValue(mockClient);

        mockRes = {
            status: vi.fn().mockReturnThis(),
            json: vi.fn().mockReturnThis(),
            setHeader: vi.fn().mockReturnThis(),
            end: vi.fn().mockReturnThis()
        };
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('GET /api/accounts', () => {
        it('should return a list of accounts with balances', async () => {
            mockReq = {
                method: 'GET',
                query: {}
            };

            const mockRows = [
                {
                    id: 1,
                    vendor: 'hapoalim',
                    account_number: '123456',
                    balance: 5000.5,
                    balance_updated_at: '2023-01-01T10:00:00Z',
                    credential_nickname: 'Main Bank',
                    credential_vendor: 'hapoalim',
                    custom_bank_account_nickname: null,
                    mapped_card_nickname: null,
                    mapped_card_vendor: null,
                    credential_id: 10,
                    linked_bank_account_id: null,
                    custom_bank_account_number: null
                }
            ];

            mockClient.query.mockResolvedValue({
                rows: mockRows,
                rowCount: 1
            });

            await indexHandler(mockReq, mockRes);

            expect(mockRes.status).toHaveBeenCalledWith(200);
            const response = mockRes.json.mock.calls[0][0];
            expect(response).toHaveLength(1);
            expect(response[0]).toMatchObject({
                id: 1,
                vendor: 'hapoalim',
                balance: 5000.5,
                nickname: 'Main Bank',
                last4: '3456'
            });
        });
    });

    describe('PATCH /api/accounts/[id]', () => {
        it('should update is_hidden status', async () => {
            mockReq = {
                method: 'PATCH',
                query: { id: '123' },
                body: { is_hidden: true }
            };

            mockClient.query.mockResolvedValue({
                rows: [{ id: 123, is_hidden: true, vendor: 'leumi', account_number: '8_81' }],
                rowCount: 1
            });

            await detailHandler(mockReq, mockRes);

            expect(mockRes.status).toHaveBeenCalledWith(200);
            expect(mockClient.query).toHaveBeenCalledWith(
                expect.stringContaining('UPDATE card_ownership'),
                ['123', true]
            );
            const response = mockRes.json.mock.calls[0][0];
            expect(response.is_hidden).toBe(true);
        });

        it('should return error for non-boolean is_hidden', async () => {
            mockReq = {
                method: 'PATCH',
                query: { id: '123' },
                body: { is_hidden: 'yes' }
            };

            await detailHandler(mockReq, mockRes);

            expect(mockRes.status).toHaveBeenCalledWith(500);
            expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({
                error: 'Internal Server Error'
            }));
        });
    });

    describe('GET /api/accounts filtering', () => {
        it('should include WHERE clause for hidden accounts by default', async () => {
            mockReq = {
                method: 'GET',
                query: {}
            };

            mockClient.query.mockResolvedValue({ rows: [] });

            await indexHandler(mockReq, mockRes);

            expect(mockClient.query).toHaveBeenCalledWith(
                expect.stringContaining('WHERE co.is_hidden = false OR co.is_hidden IS NULL'),
                []
            );
        });

        it('should NOT include WHERE clause if showHidden=true', async () => {
            mockReq = {
                method: 'GET',
                query: { showHidden: 'true' }
            };

            mockClient.query.mockResolvedValue({ rows: [] });

            await indexHandler(mockReq, mockRes);

            const sql = mockClient.query.mock.calls[0][0];
            expect(sql).not.toContain('WHERE co.is_hidden = false OR co.is_hidden IS NULL');
        });
    });
});
