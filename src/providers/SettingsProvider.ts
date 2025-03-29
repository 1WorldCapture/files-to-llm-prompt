import * as vscode from 'vscode';
import * as fs from 'fs';

export class SettingsProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'files-to-llm-prompt-settings';
    private _view?: vscode.WebviewView;
    private debugLogger: vscode.OutputChannel;
    private readonly _extensionUri: vscode.Uri;

    constructor(extensionUri: vscode.Uri) {
        this.debugLogger = vscode.window.createOutputChannel("Files-to-LLM Settings");
        this._extensionUri = extensionUri;
    }

    resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;
        this.debugLogger.appendLine('\n=== Resolving Settings Webview ===');

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: []
        };

        const config = vscode.workspace.getConfiguration('files-to-llm-prompt');
        this.debugLogger.appendLine('Current configuration: ' + JSON.stringify(config, null, 2));

        webviewView.webview.html = this._getHtmlForWebview();
        this._setWebviewMessageListener(webviewView.webview);
        
        webviewView.onDidChangeVisibility(() => {
            if (webviewView.visible) {
                webviewView.webview.html = this._getHtmlForWebview();
            }
        });
    }

    private _getHtmlForWebview() {
        const config = vscode.workspace.getConfiguration('files-to-llm-prompt');
        this.debugLogger.appendLine('\n=== Generating Settings HTML ===');
        this.debugLogger.appendLine('Using configuration: ' + JSON.stringify(config, null, 2));
        
        try {
            // 尝试从生产环境路径加载
            let htmlUri = vscode.Uri.joinPath(this._extensionUri, 'dist', 'webview', 'settings.html');
            let htmlPath = htmlUri.fsPath;
            
            // 如果生产环境路径不存在，尝试开发环境路径
            if (!fs.existsSync(htmlPath)) {
                htmlUri = vscode.Uri.joinPath(this._extensionUri, 'src', 'webview', 'settings.html');
                htmlPath = htmlUri.fsPath;
            }
            
            // 检查文件是否存在
            if (fs.existsSync(htmlPath)) {
                const htmlTemplate = fs.readFileSync(htmlPath, 'utf8');
                
                // 准备配置数据
                const configData = {
                    includeHidden: config.get('includeHidden') || false,
                    overrideGitignore: config.get('overrideGitignore') || false,
                    includeDirectories: config.get('includeDirectories') || false,
                    ignorePatterns: (config.get<string[]>('ignorePatterns') || []).join('\n'),
                    outputFormat: config.get('outputFormat') || 'default'
                };
                
                // 将配置数据注入模板 - 作为 JavaScript 对象而不是简单的字符串替换
                return htmlTemplate.replace(
                    'CONFIG_DATA_PLACEHOLDER',
                    JSON.stringify(configData)
                );
            } else {
                this.debugLogger.appendLine(`Settings HTML template not found at ${htmlPath}`);
                return '<!DOCTYPE html><html><body>Error loading settings template</body></html>';
            }
        } catch (error) {
            this.debugLogger.appendLine(`Error loading settings HTML template: ${error}`);
            return '<!DOCTYPE html><html><body>Error loading settings template</body></html>';
        }
    }

    private _setWebviewMessageListener(webview: vscode.Webview) {
        webview.onDidReceiveMessage(
            async (message) => {
                this.debugLogger.appendLine(`\n=== Received Message ===`);
                this.debugLogger.appendLine(JSON.stringify(message, null, 2));

                switch (message.type) {
                    case 'updateSetting':
                        try {
                            await vscode.workspace.getConfiguration('files-to-llm-prompt').update(
                                message.setting,
                                message.value,
                                vscode.ConfigurationTarget.Global
                            );
                            this.debugLogger.appendLine('Setting updated successfully');
                            vscode.commands.executeCommand('files-to-llm-prompt.refreshFileExplorer');
                            this.debugLogger.appendLine('Refresh command sent');
                        } catch (error) {
                            this.debugLogger.appendLine(`Error updating setting: ${error}`);
                            console.error('Error updating setting:', error);
                        }
                        break;
                }
            },
            undefined,
            []
        );
    }
}