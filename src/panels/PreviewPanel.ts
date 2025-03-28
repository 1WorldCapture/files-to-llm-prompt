import * as vscode from 'vscode';
import { ExcludedEntry } from '../providers/FileExplorerProvider';
import { countTokens, disposeEncoder, initializeEncoder } from '../utils/token-counter';
import * as fs from 'fs';

export class PreviewPanel {
    public static currentPanel: PreviewPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private _disposables: vscode.Disposable[] = [];
    private _currentPreviewFiles: string[] = []; // Files used in current preview
    private _selectedFiles: string[] = [];       // Currently selected files
    private readonly _extensionUri: vscode.Uri; // Extension URI

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
        this._panel = panel;
        this._extensionUri = extensionUri;
        
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
        this._panel.webview.html = this._getWebviewContent([]);
        this._setWebviewMessageListener(this._panel.webview);

        const config = vscode.workspace.getConfiguration('files-to-llm-prompt');
        const includeTree = config.get('includeTreeStructure') || false;
        
        this._panel.webview.postMessage({
            type: 'initializeTreeStructure',
            enabled: includeTree
        });

        // Initialize token encoder
        initializeEncoder().catch(error => {
            console.error('Failed to initialize token encoder:', error);
        });
    }

    public static createOrShow(extensionUri: vscode.Uri) {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        if (PreviewPanel.currentPanel) {
            PreviewPanel.currentPanel._panel.reveal(column);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'filesToLlmPromptPreview',
            'Files to LLM Prompt Preview',
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
            }
        );

        PreviewPanel.currentPanel = new PreviewPanel(panel, extensionUri);
    }

    public async updateContent(content: string) {
        this._currentPreviewFiles = [...this._selectedFiles];
        
        // Count tokens
        const tokenCount = await countTokens(content);
        
        this._panel.webview.postMessage({
            type: 'updatePreviewContent',
            content: content,
            tokenCount: tokenCount
        });
        
        this.checkSyncStatus();
    }
    
    public updateFileList(files: string[]) {
        this._selectedFiles = files;
        this._panel.webview.postMessage({
            type: 'updateFileList',
            files: files
        });
        this.checkSyncStatus();
    }

    public updateAvailableFiles(files: string[]) {
        this._panel.webview.postMessage({
            type: 'updateAvailableFiles',
            files: files
        });
    }
    
    private checkSyncStatus() {
        const isInSync = 
            this._currentPreviewFiles.length === this._selectedFiles.length &&
            this._currentPreviewFiles.every(file => this._selectedFiles.includes(file)) &&
            this._selectedFiles.every(file => this._currentPreviewFiles.includes(file));
    
        this._panel.webview.postMessage({
            type: 'updateSyncStatus',
            isInSync: isInSync
        });
    }

    private _getWebviewContent(files: string[]) {
        try {
            // 尝试从生产环境路径加载
            let htmlUri = vscode.Uri.joinPath(this._extensionUri, 'dist', 'webview', 'index.html');
            let htmlPath = htmlUri.fsPath;
            
            // 如果生产环境路径不存在，尝试开发环境路径
            if (!fs.existsSync(htmlPath)) {
                htmlUri = vscode.Uri.joinPath(this._extensionUri, 'src', 'webview', 'index.html');
                htmlPath = htmlUri.fsPath;
            }
            
            // 检查文件是否存在
            if (fs.existsSync(htmlPath)) {
                const htmlTemplate = fs.readFileSync(htmlPath, 'utf8');
                
                // 替换模板中的文件列表
                return htmlTemplate.replace(
                    'TEMPLATE_FILES',
                    JSON.stringify(files)
                );
            } else {
                return '<!DOCTYPE html><html><body>Error loading template</body></html>';
            }
        } catch (error) {
            console.error('Error loading HTML template:', error);
            return '<!DOCTYPE html><html><body>Error loading template</body></html>';
        }
    }

    public updateExcludedContent(entries: ExcludedEntry[]) {
        this._panel.webview.postMessage({
            type: 'updateExcludedContent',
            entries: entries
        });
    }

    private _setWebviewMessageListener(webview: vscode.Webview) {
        webview.onDidReceiveMessage(
            async (message) => {
                switch (message.type) {
                    case 'info':
                        vscode.window.showInformationMessage(message.message);
                        break;
                    case 'error':
                        vscode.window.showErrorMessage(message.message);
                        break;
                    case 'debug':
                        console.log(message.message);
                        break;
                    case 'refresh':
                        vscode.commands.executeCommand('files-to-llm-prompt.generatePrompt');
                        break;
                    case 'removeFile':
                        vscode.commands.executeCommand('files-to-llm-prompt.toggleFile', message.file);
                        break;
                    case 'addFile':
                        vscode.commands.executeCommand('files-to-llm-prompt.toggleFile', message.file);
                        break;
                    case 'searchFiles':
                        const files = await vscode.commands.executeCommand(
                            'files-to-llm-prompt.searchFiles',
                            message.searchTerm
                        );
                        webview.postMessage({
                            type: 'searchResults',
                            files: files
                        });
                        break;
                    case 'updateTreeStructure':
                        await vscode.workspace.getConfiguration('files-to-llm-prompt').update(
                            'includeTreeStructure',
                            message.enabled,
                            vscode.ConfigurationTarget.Global
                        );
                        vscode.commands.executeCommand('files-to-llm-prompt.generatePrompt');
                        break;
                    case 'updatePrompt':
                        const promptTokenCount = await countTokens(message.prompt);
                        webview.postMessage({
                            type: 'updatePromptTokens',
                            tokenCount: promptTokenCount
                        });
                        break;
                }
            },
            undefined,
            this._disposables
        );
    }

    public dispose() {
        PreviewPanel.currentPanel = undefined;
        this._panel.dispose();

        // Dispose token encoder
        disposeEncoder();
    
        while (this._disposables.length) {
            const disposable = this._disposables.pop();
            if (disposable) {
                disposable.dispose();
            }
        }
    }
}