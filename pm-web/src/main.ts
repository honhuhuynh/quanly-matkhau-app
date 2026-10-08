import './style.css';
import { VaultManager } from './vault';
import { createEmptyVault } from './types';
import { initUI } from './ui';

// Fake Data Initialization to preview UI immediately
const vault = createEmptyVault();
const manager = new VaultManager(vault);

manager.addItem({
    name: '🖥️ Máy chủ & Ảo hóa',
    type: 'Server',
    url: '',
    username: '',
    password: '',
    notes: 'Hệ thống vận hành chính (Host, VMs, iDRAC)',
    tags: ['server'],
    folder: 'IT',
    expiresAt: null,
    favorite: false,
    customFields: [],
    subAccounts: [
        { id: crypto.randomUUID(), label: 'Máy server chủ', username: 'admin_host', password: 'pwd_host' },
        { id: crypto.randomUUID(), label: 'Máy server ảo', username: 'root', password: 'pwd_vm' },
        { id: crypto.randomUUID(), label: 'iDRAC', username: 'root', password: 'pwd_idrac' },
        { id: crypto.randomUUID(), label: 'DSRM máy ảo', username: 'administrator', password: 'pwd_dsrm' },
        { id: crypto.randomUUID(), label: 'Tài khoản Agent', username: 'svc_agent', password: 'pwd_agent' }
    ]
});

manager.addItem({
    name: '🛡️ Hạ tầng Mạng & Bảo mật',
    type: 'Network',
    url: '192.168.1.1',
    username: '',
    password: '',
    notes: 'Thiết bị định tuyến, bảo mật, và VPN',
    tags: ['network', 'security'],
    folder: 'IT',
    expiresAt: null,
    favorite: false,
    customFields: [],
    subAccounts: [
        { id: crypto.randomUUID(), label: 'Firewall', username: 'admin', password: 'pwd_fw' },
        { id: crypto.randomUUID(), label: 'Switch C9300', username: 'admin', password: 'pwd_switch' },
        { id: crypto.randomUUID(), label: 'Đăng nhập VPN (Máy chủ)', username: 'vpn_admin', password: 'pwd_vpn_sv' },
        { id: crypto.randomUUID(), label: 'VPN admin', username: 'admin', password: 'pwd_vpn' },
        { id: crypto.randomUUID(), label: 'VPN Huỳnh', username: 'huynh.vpn', password: 'pwd_huynh' },
        { id: crypto.randomUUID(), label: 'Modem WifiHP', username: 'admin', password: 'pwd_modem' },
        { id: crypto.randomUUID(), label: 'Wifi', username: 'admin', password: 'pwd_wifi' }
    ]
});

manager.addItem({
    name: '💾 Lưu trữ & Sao lưu',
    type: 'Database',
    url: '',
    username: '',
    password: '',
    notes: 'Thiết bị và tool backup dữ liệu',
    tags: ['storage', 'backup'],
    folder: 'IT',
    expiresAt: null,
    favorite: false,
    customFields: [],
    subAccounts: [
        { id: crypto.randomUUID(), label: 'Máy Nas backup', username: 'admin', password: 'pwd_nas' },
        { id: crypto.randomUUID(), label: 'Backup', username: 'admin', password: 'pwd_backup' },
        { id: crypto.randomUUID(), label: 'TAKE OUT GOOGLE', username: 'admin', password: 'pwd_google' }
    ]
});

manager.addItem({
    name: '☁️ Dịch vụ & Phần mềm',
    type: 'SaaS',
    url: 'https://office.com',
    username: '',
    password: '',
    notes: 'Ứng dụng người dùng và mail',
    tags: ['apps', 'services'],
    folder: 'IT',
    expiresAt: null,
    favorite: false,
    customFields: [],
    subAccounts: [
        { id: crypto.randomUUID(), label: 'Mail', username: 'admin@company.com', password: 'pwd_mail' },
        { id: crypto.randomUUID(), label: 'OFFICE', username: 'admin@company.com', password: 'pwd_office', favorite: true }
    ]
});

// THÊM SECURE NOTE MẪU
manager.addItem({
    name: '🤖 System Prompt AI Coder',
    type: 'Note',
    url: '',
    username: '',
    password: '',
    notes: `Bạn là một chuyên gia lập trình Fullstack dày dạn kinh nghiệm.
Hãy luôn tuân thủ nguyên tắc SOLID và viết code tối ưu hiệu năng nhất có thể.

YÊU CẦU:
1. Mọi function đều phải có comment giải thích rõ ràng.
2. Không sử dụng thư viện ngoài nếu Vanilla JS/TS giải quyết được.
3. Luôn handle error triệt để.`,
    tags: ['ai', 'prompt', 'code'],
    folder: 'Notes',
    expiresAt: null,
    favorite: true,
    customFields: [],
    subAccounts: []
});

import { initAuthFlow } from './auth';

// Tạm thời che đi initUI ban đầu để bắt Login
initAuthFlow(manager);
