import type { Vault, VaultItem, SubAccount } from './types';
import { isWeakPassword } from './crypto';

export interface PasswordHealthEntry {
    itemId: string;
    itemName: string;
    subAccountId: string;
    label: string;
    pcCode?: string;
    username: string;
    password: string;
    duplicateCount: number;
    isWeak: boolean;
}

export interface PasswordHealthSummary {
    totalAccounts: number;
    duplicateAccounts: number;
    weakAccounts: number;
    duplicatePasswordsCount: Map<string, number>;
    entries: PasswordHealthEntry[];
}

export function normalizeVietnamese(input: string): string {
    if (!input) return '';
    return input
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/đ/g, 'd')
        .replace(/Đ/g, 'D')
        .toLowerCase();
}

export function isSubsequenceFuzzy(query: string, target: string): boolean {
    let qIdx = 0;
    let tIdx = 0;
    const qLen = query.length;
    const tLen = target.length;
    if (qLen === 0) return true;
    while (tIdx < tLen && qIdx < qLen) {
        if (query[qIdx] === target[tIdx]) qIdx++;
        tIdx++;
    }
    return qIdx === qLen;
}

export function matchesSearchText(rawQuery: string, ...fields: Array<string | undefined>): boolean {
    const cleanQuery = normalizeVietnamese(rawQuery).trim();
    if (!cleanQuery) return true;

    const tokens = cleanQuery.split(/\s+/).filter(Boolean);
    const normalizedFields = fields.map(f => normalizeVietnamese(f || ''));
    const combined = normalizedFields.join(' ');

    // 1. Ưu tiên khớp tất cả các từ tìm kiếm (không dấu) ở bất kỳ trường nào
    if (tokens.every(t => combined.includes(t))) {
        return true;
    }

    // 2. Nếu gõ 1 từ viết tắt (VD: 'amzn' cho 'Amazon'), chỉ fuzzy-match trong từng từ đơn lẻ để tránh nhiễu
    if (tokens.length === 1 && tokens[0].length >= 3) {
        const single = tokens[0];
        const words = combined.split(/[^a-z0-9]+/).filter(Boolean);
        for (const word of words) {
            if (isSubsequenceFuzzy(single, word)) return true;
        }
    }

    return false;
}

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
        const now = Date.now();
        const newItem: VaultItem = {
            ...item,
            id: crypto.randomUUID(),
            createdAt: now,
            updatedAt: now,
            deletedAt: null,
            subAccounts: item.subAccounts || [],
            passwordHistory: []
        };

        if (item.password) {
            newItem.passwordHistory.push({ targetLabel: 'Tài khoản chính', password: item.password, changedAt: now });
        }
        if (newItem.subAccounts) {
            newItem.subAccounts.forEach(sa => {
                if (sa.password) {
                    newItem.passwordHistory.push({ targetLabel: sa.label, password: sa.password, changedAt: now });
                }
            });
        }

        this.vault.items.push(newItem);
        return newItem;
    }

    public updateItem(id: string, updates: Partial<VaultItem>): VaultItem {
        const index = this.vault.items.findIndex(i => i.id === id);
        if (index === -1) throw new Error('Item not found');

        const existing = this.vault.items[index];
        const updated: VaultItem = {
            ...existing,
            ...updates,
            passwordHistory: existing.passwordHistory ? [...existing.passwordHistory] : [],
            updatedAt: Date.now()
        };

        // Lưu lại mật khẩu CŨ vào lịch sử nếu có sự thay đổi
        if (updates.password !== undefined && updates.password !== existing.password && existing.password) {
            updated.passwordHistory.unshift({
                targetLabel: 'Tài khoản chính',
                password: existing.password,
                changedAt: Date.now()
            });
        }

        if (updates.subAccounts) {
            updates.subAccounts.forEach(newSa => {
                const oldSa = existing.subAccounts?.find(sa => sa.id === newSa.id);
                if (oldSa && newSa.password !== oldSa.password && oldSa.password) {
                    updated.passwordHistory.unshift({
                        targetLabel: newSa.label,
                        password: oldSa.password,
                        changedAt: Date.now()
                    });
                }
            });
        }

        // Giới hạn tối đa 10 lịch sử cho MỖI tài khoản
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
        this.updateItem(id, { deletedAt: Date.now() });
    }

    public restoreFromTrash(id: string): void {
        this.updateItem(id, { deletedAt: null });
    }

    public permanentlyDelete(id: string): void {
        this.vault.items = this.vault.items.filter(i => i.id !== id);
    }

    public emptyTrash(olderThanDays = 30): void {
        const threshold = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;
        this.vault.items = this.vault.items.filter(i => {
            if (i.deletedAt !== null && i.deletedAt < threshold) {
                return false;
            }
            return true;
        });
    }

    public cloneItem(id: string): VaultItem {
        const item = this.getItem(id);
        if (!item) throw new Error('Item not found');

        return this.addItem({
            name: `${item.name} (Copy)`,
            type: item.type,
            url: item.url,
            username: item.username,
            password: item.password,
            notes: item.notes,
            tags: [...item.tags],
            folder: item.folder,
            expiresAt: item.expiresAt,
            favorite: item.favorite,
            customFields: [...item.customFields],
            subAccounts: (item.subAccounts || []).map(sa => ({ ...sa, id: crypto.randomUUID() }))
        });
    }

    public search(query: string): VaultItem[] {
        const cleanQuery = normalizeVietnamese(query).trim();
        if (!cleanQuery) return this.getItems();

        return this.getItems().filter(item => {
            const subSearch = (item.subAccounts || [])
                .map(s => `${s.label} ${s.pcCode || ''} ${s.username} ${s.notes || ''}`)
                .join(' ');
            return matchesSearchText(
                query,
                item.name,
                item.username,
                item.url,
                item.notes,
                item.folder,
                item.tags.join(' '),
                subSearch
            );
        });
    }

    public getEffectiveSubAccounts(item: VaultItem): SubAccount[] {
        if (item.subAccounts && item.subAccounts.length > 0) {
            return item.subAccounts;
        }
        if (item.username || item.password) {
            return [{
                id: `${item.id}-legacy`,
                label: 'Mặc định',
                username: item.username,
                password: item.password
            }];
        }
        return [];
    }

    public analyzePasswordHealth(): PasswordHealthSummary {
        const activeItems = this.getItems().filter(i => i.type !== 'Note');
        const dupCounts = new Map<string, number>();
        const flatAccounts: Array<{ item: VaultItem; sa: SubAccount }> = [];

        for (const item of activeItems) {
            const accounts = this.getEffectiveSubAccounts(item);
            for (const sa of accounts) {
                if (sa.status === 'revoked') continue;
                flatAccounts.push({ item, sa });
                if (sa.password) {
                    dupCounts.set(sa.password, (dupCounts.get(sa.password) || 0) + 1);
                }
            }
        }

        const entries: PasswordHealthEntry[] = [];
        let duplicateAccounts = 0;
        let weakAccounts = 0;

        for (const { item, sa } of flatAccounts) {
            const dup = sa.password ? (dupCounts.get(sa.password) || 0) : 0;
            const weak = isWeakPassword(sa.password);
            if (dup > 1) duplicateAccounts++;
            if (weak) weakAccounts++;
            if (dup > 1 || weak) {
                entries.push({
                    itemId: item.id,
                    itemName: item.name,
                    subAccountId: sa.id,
                    label: sa.label,
                    pcCode: sa.pcCode,
                    username: sa.username,
                    password: sa.password,
                    duplicateCount: dup,
                    isWeak: weak
                });
            }
        }

        return {
            totalAccounts: flatAccounts.length,
            duplicateAccounts,
            weakAccounts,
            duplicatePasswordsCount: dupCounts,
            entries
        };
    }
}
