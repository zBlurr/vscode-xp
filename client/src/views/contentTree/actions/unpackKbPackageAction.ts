import * as fs from 'fs';
import * as fse from 'fs-extra';
import * as path from 'path';
import * as vscode from 'vscode';

import { ExtensionHelper } from '../../../helpers/extensionHelper';
import { ProcessHelper } from '../../../helpers/processHelper';
import { VsCodeApiHelper } from '../../../helpers/vsCodeApiHelper';
import { Configuration } from '../../../models/configuration';
import { RuleBaseItem } from '../../../models/content/ruleBaseItem';
import { ContentTreeProvider } from '.././contentTreeProvider';

export class UnpackKbPackageAction {
	constructor(private _config: Configuration) {
	}

	public async run(selectedPackage : RuleBaseItem) : Promise<void> {

		// Проверяем путь к контрактам и копируем их.
		const packagerContractsDirectoryPath = this._config.getKnowledgePackagerContractsDirectoryPath();
		if(!fs.existsSync(packagerContractsDirectoryPath)) {
			ExtensionHelper.showUserError("Путь к специальным контактам для сборки kb-файла задан не верно. Измените его в настройках и повторите попытку.");
			await VsCodeApiHelper.openSettings(this._config.getExtentionSettingsPrefix());
			return;
		}

		// Проверка наличия утилиты сборки kb-файлов.
		const knowledgeBasePackagerCli = this._config.getKnowledgeBasePackagerCli();
		if(!fs.existsSync(knowledgeBasePackagerCli)) {
			ExtensionHelper.showUserError("Путь к утилите сборке kb-файла задан не верно. Измените его в настройках и повторите попытку.");
			await VsCodeApiHelper.openSettings(this._config.getExtentionSettingsPrefix());
			return;
		}

		const pathHelper = Configuration.get().getPathHelper();
		if(!pathHelper.isKbOpened()) {
			ExtensionHelper.showUserInfo("Нельзя распаковать пакет(ы) без открытия существующей базы знаний. Сначала откройте базу знаний.");
			return;
		}
		
		// Выбираем kb-файл.
		const kbUris = await vscode.window.showOpenDialog({
			canSelectFolders: false,
			canSelectMany: false,
			filters: {'Knowledge base (*.kb)' : ['kb']}
		});

		if(!kbUris) {
			return;
		}

		const kbFilePath = kbUris[0].fsPath; 

		// Получаем путь к директории пакетов.
		const exportDirPath = selectedPackage.getContentRoot(Configuration.get());

		if(!fs.existsSync(exportDirPath)) {
			ExtensionHelper.showUserError(`Не существует директория для пакетов.`);
			return;
		}

		return vscode.window.withProgress({
			location: vscode.ProgressLocation.Notification,
			cancellable: false,
			title: "Распаковка пакета"
		}, async (progress) => {

			// Очищаем и показываем окно Output.
			this._config.getOutputChannel().clear();

			try {
				const unpackPackagePath = this._config.getRandTmpSubDirectoryPath();
				await fs.promises.mkdir(unpackPackagePath);

				const kbFileName = path.parse(kbFilePath).name;
				const outputDirPath = path.join(unpackPackagePath, kbFileName);

				// Типовая команда выглядит так:
				// kbtools.exe unpack -s c:\tmp\pack\esc.kb -o c:\tmp\pack\unpack\doesn_t_exist_folder
				// doesn_t_exist_folder создается самим kbtools
				const output = await ProcessHelper.ExecuteWithArgsWithRealtimeOutput(
					knowledgeBasePackagerCli,
					[
						"unpack", 
						"-s", kbFilePath, 
						"-o", outputDirPath
					],
					this._config.getOutputChannel()
				);

				if(!output.includes(this.successSubstring)) {
					ExtensionHelper.showUserError(`Ошибка распаковки пакета. Смотри Output.`);
					this._config.getOutputChannel().show();
					return;
				} 

				// Если внутри несколько пакетов.
				const packagesPackagePath = path.join(outputDirPath, "packages");
				if(fs.existsSync(packagesPackagePath)) {
					await fse.copy(packagesPackagePath, exportDirPath, { overwrite: true });
				}
				
				// Если внутри один пакет.
				const objectsPackagePath = path.join(outputDirPath, "objects");
				if(!fs.existsSync(packagesPackagePath) && fs.existsSync(objectsPackagePath)) {
					const onePackagePath = path.join(exportDirPath, kbFileName);
					await fse.copy(objectsPackagePath, onePackagePath, { overwrite: true });
				}

				ExtensionHelper.showUserInfo(`Пакет успешно распакован.`);
				await ContentTreeProvider.refresh();
			}
			catch(error) {
				ExtensionHelper.showUserError("Произошла неожиданная ошибка.");
			}
		});
	}

	private readonly successSubstring = "Unpacking the knowledge base package into source format completed successfully";
}