import './style.css';
import { VaultManager } from './vault';
import { createEmptyVault } from './types';
import { initUI } from './ui';
import { initAuthFlow } from './auth';

// Khởi tạo Két trống
const vault = createEmptyVault();
const manager = new VaultManager(vault);

// Khởi động luồng xác thực (Login/Register)
initAuthFlow(manager);
