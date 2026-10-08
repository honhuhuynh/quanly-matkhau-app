import { describe, it, expect, beforeEach } from 'vitest';
import { VaultManager } from './vault';
import type { Vault } from './types';
import { createEmptyVault } from './types';

describe('VaultManager CRUD & Logic', () => {
    let vault: Vault;
    let manager: VaultManager;

    beforeEach(() => {
        vault = createEmptyVault();
        manager = new VaultManager(vault);
    });

    it('should add a new item and auto-fill metadata', () => {
        const item = manager.addItem({
            name: 'GitHub',
            type: 'Server',
            url: 'https://github.com',
            username: 'myuser',
            password: 'mypassword123',
            notes: '',
            tags: ['work', 'dev'],
            folder: 'Work',
            expiresAt: null,
            favorite: false,
            customFields: []
        });

        expect(item.id).toBeDefined();
        expect(item.createdAt).toBeDefined();
        expect(item.passwordHistory.length).toBe(1);
        expect(item.passwordHistory[0].password).toBe('mypassword123');
        expect(manager.getItems().length).toBe(1);
    });

    it('should update an item and track password history', () => {
        const item = manager.addItem({
            name: 'Google',
            type: 'Email',
            url: '',
            username: 'test',
            password: 'oldpassword',
            notes: '',
            tags: [],
            folder: '',
            expiresAt: null,
            favorite: false,
            customFields: []
        });

        manager.updateItem(item.id, { password: 'newpassword' });
        
        const updated = manager.getItem(item.id)!;
        expect(updated.password).toBe('newpassword');
        expect(updated.passwordHistory.length).toBe(2);
        expect(updated.passwordHistory[0].password).toBe('newpassword');
        expect(updated.passwordHistory[1].password).toBe('oldpassword');
    });

    it('should handle trash correctly (soft delete and restore)', () => {
        const item = manager.addItem({
            name: 'Trash Me',
            type: 'Other',
            url: '',
            username: '',
            password: '',
            notes: '',
            tags: [],
            folder: '',
            expiresAt: null,
            favorite: false,
            customFields: []
        });

        expect(manager.getItems().length).toBe(1);

        manager.moveToTrash(item.id);
        expect(manager.getItems().length).toBe(0); // Default ignores trash
        expect(manager.getItems(true).length).toBe(1); // includeTrash = true
        expect(manager.getItem(item.id)?.deletedAt).toBeDefined();

        manager.restoreFromTrash(item.id);
        expect(manager.getItems().length).toBe(1);
        expect(manager.getItem(item.id)?.deletedAt).toBeNull();
    });

    it('should fuzzy search correctly', () => {
        manager.addItem({
            name: 'Amazon Web Services',
            type: 'Server',
            url: 'https://aws.amazon.com',
            username: 'admin',
            password: '123',
            notes: '',
            tags: ['cloud'],
            folder: 'Prod',
            expiresAt: null,
            favorite: false,
            customFields: []
        });

        manager.addItem({
            name: 'Facebook',
            type: 'SaaS',
            url: 'https://facebook.com',
            username: 'john',
            password: 'abc',
            notes: '',
            tags: ['social'],
            folder: 'Personal',
            expiresAt: null,
            favorite: false,
            customFields: []
        });

        // Exact substring
        expect(manager.search('Amazon').length).toBe(1);
        // Fuzzy abbreviation
        expect(manager.search('aws').length).toBe(1); 
        // Search tag
        expect(manager.search('cloud').length).toBe(1);
        // Search across fields fuzzy (a..m..z..n)
        expect(manager.search('amzn').length).toBe(1); // 'amzn' is a fuzzy match for 'amazon'
        // No match
        expect(manager.search('netflix').length).toBe(0);
    });

    it('should clone item correctly', () => {
        const item = manager.addItem({
            name: 'Base App',
            type: 'Other',
            url: '',
            username: 'test',
            password: 'pwd',
            notes: '',
            tags: ['tag1'],
            folder: '',
            expiresAt: null,
            favorite: false,
            customFields: []
        });

        const clone = manager.cloneItem(item.id);
        expect(clone.name).toBe('Base App (Copy)');
        expect(clone.username).toBe('test');
        expect(clone.id).not.toBe(item.id);
        expect(manager.getItems().length).toBe(2);
    });
});
