import type { Vault, VaultItem } from './types';

export class VaultManager {
    private vault: Vault;

    constructor(vault: Vault) {
        this.vault = vault;
    }

    public getVault(): Vault {
        return this.vault;
    }

    public getItems(includeTrash = false): VaultItem[] {
        if (includeTrash) {
            return this.vault.items;
        }
        return this.vault.items.filter(i => i.deletedAt === null);
    }

    public getItem(id: string): VaultItem | undefined {
        return this.vault.items.find(i => i.id === id);
    }

    public addItem(item: Omit<VaultItem, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt' | 'passwordHistory'>): VaultItem {
        const newItem: VaultItem = {
            ...item,
            id: crypto.randomUUID(),
            createdAt: Date.now(),
            updatedAt: Date.now(),
            deletedAt: null,
            subAccounts: item.subAccounts || [],
            passwordHistory: []
        };
        
        if (item.password) {
            newItem.passwordHistory.push({ targetLabel: 'Tài khoản chính', password: item.password, changedAt: Date.now() });
        }
        if (item.subAccounts) {
            item.subAccounts.forEach(sa => {
                if (sa.password) {
                    newItem.passwordHistory.push({ targetLabel: sa.label, password: sa.password, changedAt: Date.now() });
                }
            });
        }

        this.vault.items.push(newItem);
        return newItem;
    }

    public updateItem(id: string, updates: Partial<VaultItem>): VaultItem {
        const index = this.vault.items.findIndex(i => i.id === id);
        if (index === -1) throw new Error("Item not found");

        const existing = this.vault.items[index];
        const updated = { ...existing, ...updates, updatedAt: Date.now() };

        // Track main password changes (Lưu lại mật khẩu CŨ vào lịch sử nếu có sự thay đổi)
        if (updates.password !== undefined && updates.password !== existing.password && existing.password) {
            updated.passwordHistory.unshift({ targetLabel: 'Tài khoản chính', password: existing.password, changedAt: Date.now() });
        }

        // Track sub account password changes
        if (updates.subAccounts) {
            updates.subAccounts.forEach(newSa => {
                const oldSa = existing.subAccounts?.find(sa => sa.id === newSa.id);
                if (oldSa) {
                    if (newSa.password !== oldSa.password && oldSa.password) {
                        // Lưu lại mật khẩu cũ của tk phụ
                        updated.passwordHistory.unshift({ targetLabel: newSa.label, password: oldSa.password, changedAt: Date.now() });
                    }
                }
            });
        }

        // Limit history to 10 entries PER TARGET LABEL (Tài khoản)
        const filteredHistory: typeof updated.passwordHistory = [];
        const labelCounts: Record<string, number> = {};
        
        for (const entry of updated.passwordHistory) {
            const label = entry.targetLabel || 'Tài khoản chính';
            labelCounts[label] = (labelCounts[label] || 0) + 1;
            if (labelCounts[label] <= 10) {
                filteredHistory.push(entry);
            }
        }
        updated.passwordHistory = filteredHistory;

        this.vault.items[index] = updated;
        return updated;
    }

    public moveToTrash(id: string): void {
        this.updateItem(id, { deletedAt: Date.now() } as Partial<VaultItem>);
    }

    public restoreFromTrash(id: string): void {
        this.updateItem(id, { deletedAt: null } as Partial<VaultItem>);
    }

    public permanentlyDelete(id: string): void {
        this.vault.items = this.vault.items.filter(i => i.id !== id);
    }

    public emptyTrash(olderThanDays = 30): void {
        const threshold = Date.now() - (olderThanDays * 24 * 60 * 60 * 1000);
        this.vault.items = this.vault.items.filter(i => {
            if (i.deletedAt !== null && i.deletedAt < threshold) {
                return false; // delete permanently
            }
            return true;
        });
    }

    public cloneItem(id: string): VaultItem {
        const item = this.getItem(id);
        if (!item) throw new Error("Item not found");
        
        const clone = { ...item };
        return this.addItem({
            name: `${clone.name} (Copy)`,
            type: clone.type,
            url: clone.url,
            username: clone.username,
            password: clone.password,
            notes: clone.notes,
            tags: [...clone.tags],
            folder: clone.folder,
            expiresAt: clone.expiresAt,
            favorite: clone.favorite,
            customFields: [...clone.customFields],
            subAccounts: clone.subAccounts.map(sa => ({...sa, id: crypto.randomUUID()}))
        });
    }

    /**
     * Fuzzy search algorithm: Checks if query characters exist in sequence in the searchable string
     */
    private isFuzzyMatch(query: string, target: string): boolean {
        let qIdx = 0;
        let tIdx = 0;
        const qLen = query.length;
        const tLen = target.length;

        if (qLen === 0) return true;

        while (tIdx < tLen && qIdx < qLen) {
            if (query[qIdx] === target[tIdx]) {
                qIdx++;
            }
            tIdx++;
        }
        return qIdx === qLen;
    }

    public search(query: string): VaultItem[] {
        const normalizedQuery = query.toLowerCase().replace(/\s+/g, ''); // ignore spaces in query
        if (!normalizedQuery) return this.getItems();

        return this.getItems().filter(item => {
            const subSearch = item.subAccounts?.map(s => `${s.label} ${s.username}`).join(' ') || '';
            const searchable = `${item.name} ${item.username} ${item.url} ${item.tags.join(' ')} ${item.folder} ${subSearch}`.toLowerCase();
            return this.isFuzzyMatch(normalizedQuery, searchable);
        });
    }
}
