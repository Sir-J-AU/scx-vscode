@{
    RootModule        = 'Kritical.PS.SCXCode.psm1'
    ModuleVersion     = '0.1.0'
    GUID              = 'e9c8f2a4-3d7b-4e5c-9a1f-8b6c2d4e5f70'
    Author            = 'Joshua Finley'
    CompanyName       = 'Kritical Pty Ltd'
    Copyright         = '(c) 2026 Kritical Pty Ltd. All rights reserved.'
    Description       = 'SCX in PowerShell the Kritical way. Chat, model list, streaming, embeddings, transcription, moderation across 12+ open-source models (MiniMax-M2.7 / MAGPiE / gpt-oss-120b / DeepSeek-V3.1 / coder / gemma-4 / Qwen3 / Llama-4-Maverick / E5-Mistral embeddings / Whisper / opir).  HKCU-based env-var convention shared with kritical.vscode.SCXCode.'

    PowerShellVersion = '7.0'

    FunctionsToExport = @(
        'Invoke-KritScx',
        'Invoke-KritScxChat',
        'Get-KritScxModels',
        'Get-KritScxConfig',
        'Set-KritScxConfig',
        'Test-KritScxConnection',
        'New-KritScxEmbedding',
        'Get-KritScxStatus',
        'Install-KritScxKey',
        'Uninstall-KritScxKey'
    )

    CmdletsToExport   = @()
    VariablesToExport = @()
    AliasesToExport   = @('scx', 'scx-chat', 'scx-models', 'scx-test')

    PrivateData = @{
        PSData = @{
            Tags         = @('SCX', 'Kritical', 'AI', 'LLM', 'Anthropic', 'MiniMax', 'gpt-oss', 'DeepSeek', 'chat', 'embeddings')
            LicenseUri   = 'https://www.apache.org/licenses/LICENSE-2.0'
            ProjectUri   = 'https://github.com/Sir-J-AU/scx-vscode'
            ReleaseNotes = 'Initial 0.1.0. Chat + model list + connection test + embeddings + HKCU install helper. Sibling of kritical.vscode.SCXCode VS Code extension.'
        }
    }
}
