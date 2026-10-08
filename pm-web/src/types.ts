export type ItemType = 'Server' | 'SaaS' | 'API_Key' | 'App_Password' | 'Database' | 'Email' | 'Other';

export interface CustomField {
    name: string;
    value: string;
    isSecret: boolean; // if true, masked like a password
}

export interface SubAccount {
    id: string; // client-side id for UI tracking
    label: string; // e.g. "User 1", "Admin", etc
    username: string;
    password: string;
    favorite?: boolean; // Starred individual accounts
    notes?: string; // Ghi chú riêng cho tài khoản con (Vd: mã 2FA)
}

export interface PasswordHistoryEntry {
    targetLabel?: string; // Ghi chú đổi cho tài khoản nào
    password: string;
    changedAt: number; // Unix timestamp
}

export interface VaultItem {
    id: string; // UUID v4
    name: string;
    type: ItemType;
    url: string;
    username: string;
    password: string; // Can be empty for certain types
    notes: string;
    tags: string[];
    folder: string;
    createdAt: number;
    updatedAt: number;
    expiresAt: number | null;
    favorite: boolean;
    customFields: CustomField[];
    subAccounts: SubAccount[];
    passwordHistory: PasswordHistoryEntry[];
    deletedAt: number | null; // Set when moved to trash
}

export interface Vault {
    version: number;
    items: VaultItem[];
}

export const createEmptyVault = (): Vault => ({
    version: 1,
    items: []
});
