import { CSVView, VIEW_TYPE_CSV } from "./view"
import { App, normalizePath, WorkspaceLeaf, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, TFolder, Platform, FuzzySuggestModal, Vault } from 'obsidian';

// Remember to rename these classes and interfaces!

interface MyPluginSettings {
	mySetting: string;
}

const DEFAULT_SETTINGS: MyPluginSettings = {
	mySetting: 'default'
}

interface ParsedPath {
	/** The full directory path such as '/home/user/dir' or 'folder/sub' */
	dir: string;
	/** The file name without extension */
	name: string;
}

const instructions = [
	{ command: '↑↓', purpose: 'to navigate' },
	{ command: 'Tab ↹', purpose: 'to autocomplete folder' },
	{ command: '↵', purpose: 'to choose folder' },
	{ command: 'esc', purpose: 'to dismiss' },
];

const path = {
	/**
	 * Parses the file path into a directory and file name.
	 * If the path string does not include a file name, it will default to
	 * 'Untitled'.
	 *
	 * @example
	 * parse('/one/two/file name')
	 * // ==> { dir: '/one/two', name: 'file name' }
	 *
	 * parse('\\one\\two\\file name')
	 * // ==> { dir: '/one/two', name: 'file name' }
	 *
	 * parse('')
	 * // ==> { dir: '', name: 'Untitled' }
	 *
	 * parse('/one/two/')
	 * // ==> { dir: '/one/two/', name: 'Untitled' }
	 */
	parse(pathString: string): ParsedPath {
		const regex = /(?<dir>([^/\\]+[/\\])*)(?<name>[^/\\]*$)/;
		const match = String(pathString).match(regex);
		const { dir, name } = match && match.groups as any;
		return { dir, name: name || 'Untitled' };
	},

	/**
	 * Joins multiple strings into a path using Obsidian's preferred format.
	 * The resulting path is normalized with Obsidian's `normalizePath` func.
	 * - Converts path separators to '/' on all platforms
	 * - Removes duplicate separators
	 * - Removes trailing slash
	 */
	join(...strings: string[]): string {
		const parts = strings.map((s) => String(s).trim()).filter((s) => s != null);
		return normalizePath(parts.join('/'));
	},
};

const EMPTY_TEXT = 'No folder found. Press esc to dismiss.';
const PLACEHOLDER_TEXT = 'Type folder name to fuzzy find.';

class CreateNoteModal extends Modal {
	folder: TFolder;
	newDirectoryPath: string;
	inputEl: HTMLInputElement;
	instructionsEl: HTMLElement;
	inputListener: EventListener;

	constructor(app: App) {
		super(app);

		// create input
		this.inputEl = document.createElement('input');
		this.inputEl.type = 'text';
		this.inputEl.placeholder = 'Type filename for new note';
		this.inputEl.className = 'prompt-input';

		// create instructions
		const instructions = [
			{
				command: '↵',
				purpose: 'to create csv (default: Untitled)',
			},
			{
				command: 'esc',
				purpose: 'to dismiss creation',
			},
		] as any;
		this.instructionsEl = document.createElement('div');
		this.instructionsEl.addClass('prompt-instructions');
		const children = instructions.map((x) => {
			const child = document.createElement('div');
			child.addClass('prompt-instruction');

			const command = document.createElement('span');
			command.addClass('prompt-instruction-command');
			command.innerText = x.command;
			child.appendChild(command);

			const purpose = document.createElement('span');
			purpose.innerText = x.purpose;
			child.appendChild(purpose);

			return child;
		});
		for (const child of children) {
			this.instructionsEl.appendChild(child);
		}

		// make modal
		this.modalEl.className = 'prompt';
		this.modalEl.innerHTML = '';
		this.modalEl.appendChild(this.inputEl);
		this.modalEl.appendChild(this.instructionsEl);

		this.inputListener = this.listenInput.bind(this);
	}

	setFolder(folder: TFolder, newDirectoryPath: string) {
		this.folder = folder;
		this.newDirectoryPath = newDirectoryPath;
	}

	listenInput(evt: KeyboardEvent) {
		if (evt.key === 'Enter') {
			// Do work
			this.createNewNote(this.inputEl.value);
			this.close();
		}
	}

	onOpen() {
		this.inputEl.focus();
		this.inputEl.addEventListener('keydown', this.inputListener);
	}

	onClose() {
		this.inputEl.removeEventListener('keydown', this.inputListener);
	}

	/**
	 * Creates a directory (recursive) if it does not already exist.
	 * This is a helper function that includes a workaround for a bug in the
	 * Obsidian mobile app.
	 */
	private async createDirectory(dir: string): Promise<void> {
		const { vault } = this.app;
		const { adapter } = vault;
		const root = vault.getRoot().path;
		const directoryPath = path.join(this.folder.path, dir);
		const directoryExists = await adapter.exists(directoryPath);
		// ===============================================================
		// -> Desktop App
		// ===============================================================
		if (!Platform.isIosApp) {
			if (!directoryExists) {
				return adapter.mkdir(normalizePath(directoryPath));
			}
		}
		// ===============================================================
		// -> Mobile App (IOS)
		// ===============================================================
		// This is a workaround for a bug in the mobile app:
		// To get the file explorer view to update correctly, we have to create
		// each directory in the path one at time.

		// Split the path into an array of sub paths
		// Note: `normalizePath` converts path separators to '/' on all platforms
		// @example '/one/two/three/' ==> ['one', 'one/two', 'one/two/three']
		// @example 'one\two\three' ==> ['one', 'one/two', 'one/two/three']
		const subPaths: string[] = normalizePath(directoryPath)
			.split('/')
			.filter((part) => part.trim() !== '')
			.map((_, index, arr) => arr.slice(0, index + 1).join('/'));

		// Create each directory if it does not exist
		for (const subPath of subPaths) {
			const directoryExists = await adapter.exists(path.join(root, subPath));
			if (!directoryExists) {
				await adapter.mkdir(path.join(root, subPath));
			}
		}
	}

	/**
	 * Handles creating the new note
	 * A new markdown file will be created at the given file path (`input`)
	 * in the specified parent folder (`this.folder`)
	 */
	async createNewNote(input: string): Promise<void> {
		const { vault } = this.app;
		const { adapter } = vault;
		const prependDirInput = path.join(this.newDirectoryPath, input);
		const { dir, name } = path.parse(prependDirInput);
		const directoryPath = path.join(this.folder.path, dir);
		const filePath = path.join(directoryPath, `${name}.csv`);

		try {
			const fileExists = await adapter.exists(filePath);
			if (fileExists) {
				// If the file already exists, respond with error
				throw new Error(`${filePath} already exists`);
			}
			if (dir !== '') {
				// If `input` includes a directory part, create it
				await this.createDirectory(dir);
			}
			const File = await vault.create(filePath, '');
			// Create the file and open it in the active leaf
			let leaf = this.app.workspace.getLeaf(false);
			// if (this.mode === NewFileLocation.NewPane) {
			// 	leaf = this.app.workspace.splitLeafOrActive();
			// } else if (this.mode === NewFileLocation.NewTab) {
			// 	leaf = this.app.workspace.getLeaf(true);
			// } else if (!leaf) {
			// default for active pane
			leaf = this.app.workspace.getLeaf(true);
			// }
			await leaf.openFile(File);
		} catch (error) {
			new Notice(error.toString());
		}
	}
}

class FilesModal extends FuzzySuggestModal<TFolder> {
	folder: TFolder;
	newDirectoryPath: string;
	inputEl: HTMLInputElement;
	instructionsEl: HTMLElement;
	inputListener: EventListener;
	folders: TFolder[];
	chooseFolder: HTMLDivElement;
	suggestionEmpty: HTMLDivElement;
	noSuggestion: boolean;
	createNoteModal: CreateNoteModal;

	constructor(app: App) {
		super(app);
		this.init();
	}

	init() {
		const folders = new Set() as Set<TFolder>;
		Vault.recurseChildren(this.app.vault.getRoot(), (file) => {
			if (file instanceof TFolder) {
				folders.add(file);
			}
		});
		this.folders = Array.from(folders);
		this.emptyStateText = EMPTY_TEXT;
		this.setPlaceholder(PLACEHOLDER_TEXT);
		this.setInstructions(instructions);
		this.initChooseFolderItem();
		this.createNoteModal = new CreateNoteModal(this.app);

		this.inputListener = this.listenInput.bind(this);
	}

	getItems(): TFolder[] {
		return this.folders;
	}

	getItemText(item: TFolder): string {
		this.noSuggestion = false;
		return item.path;
	}

	onNoSuggestion() {
		this.noSuggestion = true;
		this.newDirectoryPath = this.inputEl.value;
		this.resultContainerEl.childNodes.forEach((c) =>
			c.parentNode?.removeChild(c)
		);
		this.chooseFolder.innerText = this.inputEl.value;
		this.itemInstructionMessage(
			this.chooseFolder,
			'Press ↵ or append / to create folder.'
		);
		this.resultContainerEl.appendChild(this.chooseFolder);
		this.resultContainerEl.appendChild(this.suggestionEmpty);
	}

	shouldCreateFolder(evt: MouseEvent | KeyboardEvent): boolean {
		if (this.newDirectoryPath.endsWith('/')) {
			return true;
		}
		if (evt instanceof KeyboardEvent && evt.key == 'Enter') {
			return true;
		}
		return false;
	}

	findCurrentSelect(): HTMLElement {
		return document.querySelector('.suggestion-item.is-selected') as any;
	}

	listenInput(evt: KeyboardEvent) {
		if (evt.key == 'Tab') {
			this.inputEl.value = this.findCurrentSelect()?.innerText;
			// to disable tab selections on input
			evt.preventDefault();
		}
	}

	onOpen() {
		super.onOpen();
		this.inputEl.addEventListener('keydown', this.inputListener);
	}

	onClose() {
		this.inputEl.removeEventListener('keydown', this.inputListener);
		super.onClose();
	}

	onChooseItem(item: TFolder, evt: MouseEvent | KeyboardEvent): void {
		if (this.noSuggestion) {
			if (!this.shouldCreateFolder(evt)) {
				return;
			}
			this.createNoteModal.setFolder(
				this.app.vault.getRoot(),
				this.newDirectoryPath
			);
		} else {
			this.createNoteModal.setFolder(item, '');
		}
		this.createNoteModal.open();
	}

	initChooseFolderItem() {
		this.chooseFolder = document.createElement('div');
		this.chooseFolder.addClasses(['suggestion-item', 'is-selected']);
		this.suggestionEmpty = document.createElement('div');
		this.suggestionEmpty.addClass('suggestion-empty');
		this.suggestionEmpty.innerText = EMPTY_TEXT;
	}

	itemInstructionMessage(resultEl: HTMLElement, message: string) {
		const el = document.createElement('kbd');
		el.addClass('suggestion-hotkey');
		el.innerText = message;
		resultEl.appendChild(el);
	}
}

export default class GridViewPlugin extends Plugin {
	settings: MyPluginSettings;

	async onload() {
		await this.loadSettings();

		this.registerView(
			VIEW_TYPE_CSV, (leaf: WorkspaceLeaf) => new CSVView(leaf)
		);

		this.registerExtensions(["csv"], VIEW_TYPE_CSV);

		this.addCommand({
			id: 'gridview-new-file',
			name: 'Create csv in the current pane',
			callback: () => {
				new FilesModal(this.app).open();
			},
		});
	}

	onunload() {

	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

// class SampleSettingTab extends PluginSettingTab {
// 	plugin: MyPlugin;

// 	constructor(app: App, plugin: MyPlugin) {
// 		super(app, plugin);
// 		this.plugin = plugin;
// 	}

// 	display(): void {
// 		const {containerEl} = this;

// 		containerEl.empty();

// 		containerEl.createEl('h2', {text: 'Settings for my awesome plugin.'});

// 		new Setting(containerEl)
// 			.setName('Setting #1')
// 			.setDesc('It\'s a secret')
// 			.addText(text => text
// 				.setPlaceholder('Enter your secret')
// 				.setValue(this.plugin.settings.mySetting)
// 				.onChange(async (value) => {
// 					console.log('Secret: ' + value);
// 					this.plugin.settings.mySetting = value;
// 					await this.plugin.saveSettings();
// 				}));
// 	}
// }
