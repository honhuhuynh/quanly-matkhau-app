import './style.css';
import { VaultManager } from './vault';
import { createEmptyVault } from './types';
import { initAuthFlow } from './auth';

const vault = createEmptyVault();
const manager = new VaultManager(vault);

initAuthFlow(manager);
