export type ItemCategory = 'Email' | 'Server' | 'Network' | 'API' | 'Other';

export type ItemType =
    | 'Account'
    | 'Note'
    | 'Server'
    | 'SaaS'
    | 'API_Key'
    | 'App_Password'
    | 'Database'
    | 'Email'
    | 'Other';

export interface CustomField {
    name: string;
    value: string;
    isSecret: boolean;
}

export interface SubAccount {
    id: string;
    label: string;
    username: string;
    password: string;
    pcCode?: string; // Mã máy trạm / vị trí (VD: ARC-HP01)
    status?: 'active' | 'revoked' | 'pending';
    favorite?: boolean;
    notes?: string; // Ghi chú riêng / mã dự phòng 2FA
    updatedAt?: number;
}

export interface PasswordHistoryEntry {
    targetLabel?: string;
    password: string;
    changedAt: number;
}

export interface VaultItem {
    id: string;
    name: string;
    type: ItemType;
    url: string;
    username: string;
    password: string;
    notes: string;
    tags: string[];
    folder: string; // Lưu danh mục (Email, Server, Network, API, Other)
    createdAt: number;
    updatedAt: number;
    expiresAt: number | null;
    favorite: boolean;
    customFields: CustomField[];
    subAccounts: SubAccount[];
    passwordHistory: PasswordHistoryEntry[];
    deletedAt: number | null;
}

export interface Vault {
    version: number;
    items: VaultItem[];
}

export const createEmptyVault = (): Vault => ({
    version: 1,
    items: []
});

export const CATEGORY_OPTIONS: { id: ItemCategory; label: string; icon: string }[] = [
    { id: 'Email', label: 'Email / Gmail', icon: '📧' },
    { id: 'Server', label: 'Server / NAS / DB', icon: '🖥️' },
    { id: 'Network', label: 'Mạng / VPN / FW', icon: '🌐' },
    { id: 'API', label: 'API / Tool / License', icon: '🔑' },
    { id: 'Other', label: 'Khác', icon: '📦' }
];

export function resolveItemCategory(item: VaultItem): ItemCategory {
    if (item.folder === 'Email' || item.folder === 'Server' || item.folder === 'Network' || item.folder === 'API' || item.folder === 'Other') {
        return item.folder;
    }
    const text = `${item.type} ${item.name} ${item.url} ${item.tags.join(' ')}`.toLowerCase();
    if (item.type === 'Email' || text.includes('gmail') || text.includes('mail')) return 'Email';
    if (item.type === 'Server' || item.type === 'Database' || text.includes('server') || text.includes('idrac') || text.includes('nas') || text.includes('hyper')) return 'Server';
    if (text.includes('vpn') || text.includes('forti') || text.includes('switch') || text.includes('wifi') || text.includes('router')) return 'Network';
    if (item.type === 'API_Key' || item.type === 'App_Password' || item.type === 'SaaS' || text.includes('api') || text.includes('github') || text.includes('token') || text.includes('autodesk')) return 'API';
    return 'Other';
}
