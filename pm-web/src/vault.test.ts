import { describe, it, expect, beforeEach } from 'vitest';
import { VaultManager, normalizeVietnamese } from './vault';
import type { Vault } from './types';
import { createEmptyVault } from './types';

describe('VaultManager CRUD, Vietnamese Search & Health Audit', () => {
    let vault: Vault;
    let manager: VaultManager;

    beforeEach(() => {
        vault = createEmptyVault();
        manager = new VaultManager(vault);
    });

    it('should add a new item and record initial password history', () => {
        const item = manager.addItem({
            name: 'GitHub',
            type: 'Server',
            url: 'https://github.com',
            username: '',
            password: '',
            notes: '',
            tags: ['work', 'dev'],
            folder: 'API',
            expiresAt: null,
            favorite: false,
            customFields: [],
            subAccounts: [
                { id: 'sa-1', label: 'Admin', username: 'myuser', password: 'mypassword123' }
            ]
        });

        expect(item.id).toBeDefined();
        expect(item.createdAt).toBeDefined();
        expect(item.passwordHistory.length).toBe(1);
        expect(item.passwordHistory[0].password).toBe('mypassword123');
        expect(manager.getItems().length).toBe(1);
    });

    it('should preserve old sub-account password in history when updated', () => {
        const item = manager.addItem({
            name: 'Google',
            type: 'Account',
            url: 'https://mail.google.com',
            username: '',
            password: '',
            notes: '',
            tags: [],
            folder: 'Email',
            expiresAt: null,
            favorite: false,
            customFields: [],
            subAccounts: [
                { id: 'sa-1', label: 'Nhân viên A', username: 'a@gmail.com', password: 'oldpassword' }
            ]
        });

        manager.updateItem(item.id, {
            subAccounts: [
                { id: 'sa-1', label: 'Nhân viên A', username: 'a@gmail.com', password: 'newpassword' }
            ]
        });

        const updated = manager.getItem(item.id)!;
        expect(updated.subAccounts[0].password).toBe('newpassword');
        expect(updated.passwordHistory.length).toBe(2);
        expect(updated.passwordHistory[0].password).toBe('oldpassword');
        expect(updated.passwordHistory[0].targetLabel).toBe('Nhân viên A');
    });

    it('should handle trash lifecycle including permanent delete', () => {
        const item = manager.addItem({
            name: 'Trash Me',
            type: 'Account',
            url: '',
            username: '',
            password: '',
            notes: '',
            tags: [],
            folder: 'Other',
            expiresAt: null,
            favorite: false,
            customFields: [],
            subAccounts: []
        });

        expect(manager.getItems().length).toBe(1);

        manager.moveToTrash(item.id);
        expect(manager.getItems().length).toBe(0);
        expect(manager.getItems(true).length).toBe(1);

        manager.restoreFromTrash(item.id);
        expect(manager.getItems().length).toBe(1);

        manager.permanentlyDelete(item.id);
        expect(manager.getItems(true).length).toBe(0);
    });

    it('should search Vietnamese without diacritics, pcCode, notes, and fuzzy abbreviations', () => {
        expect(normalizeVietnamese('Nguyễn Minh Lý • Đông An')).toBe('nguyen minh ly • dong an');

        manager.addItem({
            name: 'Amazon Web Services',
            type: 'Server',
            url: 'https://aws.amazon.com',
            username: 'admin',
            password: '123',
            notes: 'Root cloud infra',
            tags: ['cloud'],
            folder: 'Server',
            expiresAt: null,
            favorite: false,
            customFields: [],
            subAccounts: []
        });

        manager.addItem({
            name: 'Gmail Nhân Sự',
            type: 'Account',
            url: 'https://mail.google.com',
            username: '',
            password: '',
            notes: '',
            tags: [],
            folder: 'Email',
            expiresAt: null,
            favorite: false,
            customFields: [],
            subAccounts: [
                {
                    id: 'g-1',
                    label: 'Nguyễn Minh Lý',
                    pcCode: 'ARC-HP01',
                    username: 'ly@gmail.com',
                    password: 'SharedPassword!1',
                    notes: '2FA backup 998877'
                }
            ]
        });

        expect(manager.search('Amazon').length).toBe(1);
        expect(manager.search('amzn').length).toBe(1);
        expect(manager.search('minh ly').length).toBe(1);
        expect(manager.search('arc-hp01').length).toBe(1);
        expect(manager.search('998877').length).toBe(1);
        expect(manager.search('netflix').length).toBe(0);
    });

    it('should detect duplicate and weak passwords cleanly', () => {
        manager.addItem({
            name: 'Gmail Nhân Sự',
            type: 'Account',
            url: '',
            username: '',
            password: '',
            notes: '',
            tags: [],
            folder: 'Email',
            expiresAt: null,
            favorite: false,
            customFields: [],
            subAccounts: [
                { id: '1', label: 'NV 1', username: 'nv1@gmail.com', password: 'SamePassword1!' },
                { id: '2', label: 'NV 2', username: 'nv2@gmail.com', password: 'SamePassword1!' },
                { id: '3', label: 'NV 3', username: 'nv3@gmail.com', password: '1234' },
                { id: '4', label: 'NV 4', username: 'nv4@gmail.com', password: 'UniqueStrong#2026' }
            ]
        });

        const health = manager.analyzePasswordHealth();
        expect(health.totalAccounts).toBe(4);
        expect(health.duplicateAccounts).toBe(2);
        expect(health.weakAccounts).toBe(1);
        expect(health.entries.length).toBe(3);
    });
});
