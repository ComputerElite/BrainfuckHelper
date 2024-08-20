// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import { time } from 'console';
import { TextEncoder } from 'util';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as readline from 'readline';
import * as path from 'path';

enum CEBFKeywordScope {
	Compiler,
	InFile,
	InIncludedFile,
	Undefined
}

enum CEBFItemKind {
	Function = vscode.CompletionItemKind.Function,
	Variable = vscode.CompletionItemKind.Variable,
	Label = vscode.CompletionItemKind.Module
}

class CEBFKeyword {
	label: string;
	detail: string;
	documentation: string;
	kind: vscode.CompletionItemKind;
	scope: CEBFKeywordScope;
	insertText?: vscode.SnippetString;
	definition?: vscode.Location;
	filterText?: string;
	onlyShowInMacroArgumentCount: number = -1;
	argumentCount: number = 0;
	checkArgumentCount: boolean = true;
	checkForUnescapedStrings: boolean = false;
	freedAt: vscode.Location | undefined;

	arguments: string[] = []
	private _canBeLabel: boolean = false;
	private _canBeFirstWord: boolean = false;

	public get canBeFirstWord(): boolean {
		return this._canBeFirstWord || this.kind == vscode.CompletionItemKind.Function;
	}

	public set canBeFirstWord(value: boolean) {
		this._canBeFirstWord = value;
	}

	public get canBeLabel(): boolean {
		return this._canBeLabel || this.kind == vscode.CompletionItemKind.Module;
	}

	public set canBeLabel(value: boolean) {
		this._canBeLabel = value
	}

	public get canBeLabelInFile(): boolean {
		return this.kind == vscode.CompletionItemKind.Module && this.scope == CEBFKeywordScope.InFile || this.canBeLabel
	}

	public get canBeVariable(): boolean {
		return this.kind == vscode.CompletionItemKind.Variable;
	}

	canBeVariableHere(argumentCountOfMacro: number): boolean {
		if(!this.canBeVariable) return false;
		if(this.onlyShowInMacroArgumentCount == -1) return true;
		if(argumentCountOfMacro == -1) return false;
		return this.onlyShowInMacroArgumentCount <= argumentCountOfMacro;
	}

	canBeLabelInFileHere(argumentCountOfMacro: number): boolean {
		if(!this.canBeLabelInFile) return false;
		if(this.onlyShowInMacroArgumentCount == -1) return true;
		if(argumentCountOfMacro == -1) return false;
		return this.onlyShowInMacroArgumentCount <= argumentCountOfMacro;
	}
	

	constructor(label: string, kind: vscode.CompletionItemKind, detail: string = "", documentation: string = "", scope: CEBFKeywordScope = CEBFKeywordScope.Undefined) {
		this.label = label;
		this.detail = detail;
		this.kind = kind;
		this.documentation = documentation;
		this.scope = scope;
		this.insertText = undefined;
		this.definition = undefined;
	}

	toCompletionItem(): vscode.CompletionItem {
		let item = new vscode.CompletionItem(this.label, this.kind);
		item.detail = this.detail;
		item.filterText = this.filterText;
		item.documentation = this.documentation;
		item.insertText = this.insertText;
		return item;
	}

	toSignature(): vscode.SignatureInformation {
		let sig = new vscode.SignatureInformation(this.detail);
		sig.documentation = this.documentation;
		sig.parameters = this.arguments.map(x => new vscode.ParameterInformation(x));
		return sig;
	}

	autoPopulate(i: number, lines: string[], split: string[], keywordScope = CEBFKeywordScope.Undefined, file: string = "") {
		this.scope = keywordScope;
		[this.detail, this.documentation, this.argumentCount] = getDocsOfKeyword(i, lines, split);
		this.definition = new vscode.Location(vscode.Uri.file(file), new vscode.Position(i, 0));
		
		this.analyzeCompletion();
	}

	populateArguments() {
		this.arguments = []
		for (const s of this.detail.split("<")) {
			if (s.includes(">")) {
				this.arguments.push(s.split(">")[0]);
			}
		}
		if(this.arguments.length < this.argumentCount) {
			for(let i = 0; i < this.argumentCount - this.arguments.length; i++) {
				this.arguments.push("arg" + i.toString());
				this.detail += " <arg" + i.toString() + ">"
			}
		}

		if(!this.detail.startsWith(this.label)) {
			// fix it when idiots forget to rename the function in their usage comment
			let partialDetails = this.detail.split(" ")
			partialDetails.splice(0, 1)
			this.detail = this.label + " " + partialDetails.join(" ")
		}
	}

	analyzeCompletion() {
		let split = splitByArguments(this.detail);
		labelCompletions[this.label] = []
		variableCompletions[this.label] = []
		for(let i = 0; i < split.length; i++) {
			if(split[i] == "<label>") {
				labelCompletions[split[0]].push(i - 1);						
			}
			if(split[i].toLowerCase().includes("address")) {
				variableCompletions[split[0]].push(i - 1);

			}
		}
		this.populateArguments();
	}
}

function splitByArguments(text: string): string[] {
	let inQuotationMark = false;
    const newCmds: string[] = [];
	let cmds = text.split(" ");

    for (let s of cmds) {
        const wasInQuotationMark = inQuotationMark;
        let nS = s.replace(/\\"/g, "\"");

        if (s.startsWith("\"")) {
            inQuotationMark = true;
            nS = s.substring(1);
        }

        if (s.endsWith("\"") && !s.endsWith("\\\"")) {
            inQuotationMark = false;
            nS = s.substring(0, s.length - 1);
        }

        if (wasInQuotationMark) {
            newCmds[newCmds.length - 1] += " " + nS;
        } else {
            newCmds.push(nS);
        }
    }

    return newCmds;
}

var compilerKeywords: CEBFKeyword[] = []
var outputChannelForDebugging: vscode.OutputChannel;
var labelCompletions: {[id: string]: number[]}= {}
var variableCompletions: {[id: string]: number[]}= {}

function getDocsOfKeyword(i: number, lines: string[], split: string[]): any[] {
	let usage: string = "";
	let documentation: string = "";
	for(let j = i - 1; j >= 0; j--) {
		if(!lines[j].startsWith(";;")) break; // end of comment definition
		if(lines[j].startsWith(";; " + split[1])) {
			usage = lines[j].substring(3);
		} else 
		{
			documentation = lines[j].substring(3) + "\n" + documentation;
		}
	}
	return [usage, documentation, usage.split("<").length - 1];
}

function processDocs(context: vscode.ExtensionContext) {
	const filePath = path.join(context.extensionPath, 'res', 'docs.cebf');

	const fileStream = fs.createReadStream(filePath);

	const rl = readline.createInterface({
		input: fileStream,
		crlfDelay: Infinity // Recognize all instances of CR LF ('\r\n') in file as a single line break.
	});

	rl.on('line', (line) => {
		// Process each line
		//outputChannel.appendLine(line)
		if(/;; [^_ $]/.test(line)) {

			let split = splitByArguments(line)
			split.splice(0, 1);
			let keyword = new CEBFKeyword(split[0], vscode.CompletionItemKind.Function);
			keyword.scope = CEBFKeywordScope.Compiler;
			switch(split[0]) {
				case "macro":
					keyword.insertText = new vscode.SnippetString(";; Usage\n;; $1\n" + split[0] + " $1 $2\nmacroend");
					break;
				case "sad":
					keyword.insertText = new vscode.SnippetString(";; Variable description\n" + split[0] + " ");
					break;
				case "wrt.s":
					keyword.checkArgumentCount = false;
					keyword.checkForUnescapedStrings = true;
			}
			let usage = "";
			let documentation = "";
			let isUsage = true;
			labelCompletions[split[0]] = []
			for(let i = 0; i < split.length; i++) {
				if(split[i] == "") {
					isUsage = false;
					continue;
				}
				if(isUsage) {
					usage += split[i] + " ";
				} else {
					documentation += split[i] + " ";
				}
			}
			keyword.documentation = documentation;
			keyword.detail = usage;
			keyword.argumentCount = usage.split("<").length - 1;
			if(keyword.label.startsWith("#")) {
				keyword.kind = vscode.CompletionItemKind.Keyword;
				keyword.canBeFirstWord = true;
				//keyword.filterText = keyword.label.substring(1);
				//keyword.insertText = new vscode.SnippetString(keyword.label.substring(1));
			}
			keyword.analyzeCompletion();
			compilerKeywords.push(keyword);
		}
	});
    
}

function GetCompletionOfFile(text: string, file: string, isIncludedFile: boolean = false): CEBFKeyword[] {
	let lines = text.split("\n");
	let completions: CEBFKeyword[] = []
	for(let i = 0; i < lines.length; i++) {
		let line = lines[i];
		if(line.startsWith(";;")) continue; // ignore comments

		let split = splitByArguments(line);
		let keywordScope = isIncludedFile ? CEBFKeywordScope.InIncludedFile : CEBFKeywordScope.InFile;
		if(line.startsWith("macro ") ) {
			// macro found
			let keyword = new CEBFKeyword(split[1], vscode.CompletionItemKind.Function);
			keyword.autoPopulate(i, lines, split, keywordScope, file);
			keyword.argumentCount = parseInt(split[2])
			keyword.analyzeCompletion(); // reanalyze completion as we manually changed argument count
			completions.push(keyword);
		} else if(line.startsWith("sad ")) {
			// Variable decleration found
			let keyword = new CEBFKeyword("$" + split[2], vscode.CompletionItemKind.Variable);
			keyword.autoPopulate(i, lines, split, keywordScope, file);
			completions.push(keyword);
		} else if(line.startsWith("all ")) {
			// Variable allocation found
			let keyword = new CEBFKeyword("$" + split[1], vscode.CompletionItemKind.Variable);
			keyword.autoPopulate(i, lines, split, keywordScope, file);
			completions.push(keyword);
		} else if(line.startsWith("fre ")) {
			// Variable free found
			var freedVar = completions.find(x => x.label == "$" + split[1]);
			if(freedVar) {
				freedVar.freedAt = new vscode.Location(vscode.Uri.file(file), new vscode.Position(i, 0));
			}
		} else if(line.startsWith("#include ")) {
			line = line.substring(9);
			let includeFile = line.replace(/"/g, "");
			let includeFilePath = path.dirname(file) + "/" + includeFile;
			if(fs.existsSync(includeFilePath)) {
				let text = fs.readFileSync(includeFilePath).toString();
				completions.push(...GetCompletionOfFile(text, includeFilePath, true));
			}
		} else if(line.startsWith(":")) {
			let keyword = new CEBFKeyword(split[0].substring(1), vscode.CompletionItemKind.Module);
			keyword.autoPopulate(i, lines, split, keywordScope, file);
			completions.push(keyword);
		}
	}
	return completions;
}

function AnalyzeDocument(document: vscode.TextDocument) {
	let results: CEBFKeyword[] = []
	results.push(...compilerKeywords)
	results.push(...GetCompletionOfFile(document.getText(), document.fileName))
	return results
}

function loadCompilerKeywords(context: vscode.ExtensionContext) {
	processDocs(context)
	// Add predefined variables
	for(let i = 0; i < 10; i++) {
		let keyword = new CEBFKeyword("$" + i.toString(), vscode.CompletionItemKind.Variable);
		keyword.scope = CEBFKeywordScope.Compiler;
		keyword.canBeLabel = true;
		keyword.onlyShowInMacroArgumentCount = i + 1;
		keyword.documentation = "Argument " + i.toString() + " passed to the macro you're currently in. Aka this variable will get replaced with whatever the user passes in.";
		compilerKeywords.push(keyword);
	}
	for(let i = 0; i < 2; i++) {
		let keyword = new CEBFKeyword("$cebf_interpreter_" + i.toString(), vscode.CompletionItemKind.Variable);
		keyword.scope = CEBFKeywordScope.Compiler;
		keyword.documentation = "Internal variable for communication with the CEBF interpreter. " +(i == 0 ? "For telling it what to do" : "For feedback from the interpreter") + "\n\nBehavior can be looked up at https://github.com/ComputerElite/BrainfuckInterpreter/blob/main/CEBrainfuckInterpreter/CEBrainfuckInterpreter/README.md";
		compilerKeywords.push(keyword);
	}
	for(let i = 0; i < 14; i++) {
		let keyword = new CEBFKeyword("$cebf_stdlib_" + i.toString(), vscode.CompletionItemKind.Variable);
		keyword.scope = CEBFKeywordScope.Compiler;
		keyword.documentation = "Do not use! Variable where the standard library saves stuff";
		compilerKeywords.push(keyword);
	}
}

function updateDiagnostics(document: vscode.TextDocument, diagnosticCollection: vscode.DiagnosticCollection) {
	let keywords: CEBFKeyword[] = AnalyzeDocument(document)
	const diagnostics: vscode.Diagnostic[] = [];

	for(let i = 0; i < document.lineCount; i++) {
		let line: vscode.TextLine = document.lineAt(i);
		let lineTxt: string = line.text.trimEnd();
		let split: string[] = splitByArguments(lineTxt);
		let foundKeyword = undefined;
		if(split[0] != "" && !split[0].startsWith(";;") && !split[0].startsWith(":")) {
			// not comment and not empty
			foundKeyword = keywords.find(x => x.canBeFirstWord && split[0] == x.label);
			if(!foundKeyword) {
				diagnostics.push(new vscode.Diagnostic(new vscode.Range(i, 0, i, split[0].length), split[0] + " does not exist in this context", vscode.DiagnosticSeverity.Error))
			} else if(foundKeyword.checkArgumentCount) {	
				// check argument count
				let argumentCount = split.findIndex(x => x.startsWith(";;")) -1;
				if(argumentCount == -2) argumentCount = split.length - 1;
				if(foundKeyword.argumentCount != argumentCount) {
					diagnostics.push(new vscode.Diagnostic(new vscode.Range(i, 0, i, split[0].length), split[0] + " expects " + foundKeyword.argumentCount + " arguments, but got " + argumentCount, vscode.DiagnosticSeverity.Error))
				}
				switch(foundKeyword.label) {
					case "macro":
						// check if macro is closed
						let foundMacroEnd = false;
						for(let j = i + 1; j < document.lineCount; j++) {
							if(document.lineAt(j).text.startsWith("macroend")) {
								foundMacroEnd = true;
								break;
							}
						}
						if(!foundMacroEnd) {
							diagnostics.push(new vscode.Diagnostic(new vscode.Range(i, 0, i, split[0].length), "Macro " + split[1] + " is not closed", vscode.DiagnosticSeverity.Error))
						}
						break;
					case "macroend":
						// check if macro is opened
						let foundMacro = false;
						for(let j = i - 1; j >= 0; j--) {
							if(document.lineAt(j).text.startsWith("macro ")) {
								foundMacro = true;
								break;
							}
						}
						if(!foundMacro) {
							diagnostics.push(new vscode.Diagnostic(new vscode.Range(i, 0, i, split[0].length), "Macroend without macro", vscode.DiagnosticSeverity.Error))
						}
						break;
					case "sad":
						// deprecated
						diagnostics.push(new vscode.Diagnostic(new vscode.Range(i, 0, i, lineTxt.length), "Warning: Address naming via sad is deprecated. Use all instead to let the compiler decide where to place the variable.", vscode.DiagnosticSeverity.Warning))
				}
			}
			let macroArgumentCount = argumentsForMacroAtPositionInDocument(document.getText(), i);
			let argumentStartIndex = 0;
			let firstWord = split[0];
			for(let j= 0; j < split.length; j++) {
				if(split[j].startsWith("$")) {
					// check if variable exists
					let f = keywords.find(x => x.canBeVariableHere(macroArgumentCount) && split[j] == x.label);
					if(!f) {
						diagnostics.push(new vscode.Diagnostic(new vscode.Range(i, argumentStartIndex, i, argumentStartIndex + split[j].length), "Variable " + split[j] + " does not exist in this context", vscode.DiagnosticSeverity.Error))
					} else {
						// check if variable has been freed
						if(f.freedAt) {
							if(f.freedAt.uri == document.uri) {
								if(f.freedAt.range.start.line < i) {
									diagnostics.push(new vscode.Diagnostic(new vscode.Range(i, argumentStartIndex, i, argumentStartIndex + split[j].length), "Variable " + split[j] + " has already been freed", vscode.DiagnosticSeverity.Warning))
								}
	
							}
						}
					}
				}
				if(foundKeyword) {
					// Check for labels
					let argumentIndex = j - 1;
					if(labelCompletions[firstWord].includes(argumentIndex)) {
						// check if label exists
	
						let f = keywords.find(x => x.canBeLabelInFileHere(macroArgumentCount) && split[j] == x.label);
						if(!f) {
							diagnostics.push(new vscode.Diagnostic(new vscode.Range(i, argumentStartIndex, i, argumentStartIndex + split[j].length), "Label " + split[j] + " does not exist in this context", vscode.DiagnosticSeverity.Error))
						}
					}
				}
				argumentStartIndex += split[j].length + 1;
			}
		
		}

		if(foundKeyword && foundKeyword.checkForUnescapedStrings) {
			// On wrt.s show warnings for unescaped strings
			for(let k = 0; k < lineTxt.length; k++) {
				if(lineTxt[k] == '"') {
					if(k == 0 || lineTxt[k-1] != "\\" && (k == lineTxt.length - 1 || lineTxt[k+1] != "\\")) {
						diagnostics.push(new vscode.Diagnostic(new vscode.Range(i, k, i, k + 1), "Unescaped double quotation may be grouped as one argument and thus be removed.\n\ne. g. 'wrt.s They said \"I use arch btw\"'\nwill be output as\n'They said I use arch btw'\ninstead of\n'They said \"I use arch btw\"'", vscode.DiagnosticSeverity.Warning))
					}
				}
			}
		}
	}
	diagnosticCollection.set(document.uri, diagnostics);

}

function argumentsForMacroAtPositionInDocument(text: string, line: number): number {
	let lines = text.split("\n");
	for(let i = line - 1; i >= 0; i--) {
		if(lines[i].startsWith("macroend")) return -1;
		if(lines[i].startsWith("macro ")) {
			let split = splitByArguments(lines[i]);
			if(split.length < 3) return -1;
			return parseInt(splitByArguments(lines[i])[2]);
		}
	}
	return -1;
}

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
	outputChannelForDebugging = vscode.window.createOutputChannel("preload")
	loadCompilerKeywords(context)
	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('Congratulations, your extension "brainfuckhelper" is now active!');

	// The command has been defined in the package.json file
	// Now provide the implementation of the command with registerCommand
	// The commandId parameter must match the command field in package.json
	let outputChannel = vscode.window.createOutputChannel("brainfuck")

	const diagnosticCollection = vscode.languages.createDiagnosticCollection('cebrainfuck');
    vscode.workspace.onDidChangeTextDocument(event => {
        const document = event.document;
        if (document.languageId === 'cebrainfuck') { // Ensure it's the correct language
            updateDiagnostics(document, diagnosticCollection);
        }
    });
	let signatureProvider = vscode.languages.registerSignatureHelpProvider(
        { language: 'cebrainfuck' }, 
        {
            provideSignatureHelp(document, position, token, context) {
                
				const lineText = document.lineAt(position).text;
				const lineTillPosition = lineText.substring(0, position.character).trimStart();

				let firstWord = lineText.match(/^[^ ]+/)?.[0]
				// Get index of current argument by counting whitespaces preceeding position
				let argumentIndex = splitByArguments(lineTillPosition).length - 2 // remove 1 cause of length to index conversion and 1 for command
				let keywords = AnalyzeDocument(document);
				let keyword = keywords.find(x => x.canBeFirstWord && x.label == firstWord);
				if (!keyword) return null;
				outputChannelForDebugging.appendLine("Providing signature for " + keyword.label)
                const signatureHelp = new vscode.SignatureHelp();
                signatureHelp.signatures = [keyword.toSignature()];
                signatureHelp.activeSignature = 0;
                signatureHelp.activeParameter = argumentIndex;

                return signatureHelp;
            }
        },
        ' ' // Triggers for signature help
    )
	let completionProvider = vscode.languages.registerCompletionItemProvider('cebrainfuck', {
		provideCompletionItems(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken, context: vscode.CompletionContext) {
			const lineText = document.lineAt(position).text;
			const lineTillPosition = lineText.substring(0, position.character).trimStart();
			const isFirstWord = lineTillPosition.length === 0 || /^[^\s]+$/.test(lineTillPosition);
			let completions = []
			let keywords = AnalyzeDocument(document)
			if(isFirstWord) {
				completions.push(...keywords.filter(x => x.canBeFirstWord))
			}
			let firstWord = lineText.match(/^[^ ]+/)?.[0]
			// Get index of current argument by counting whitespaces preceeding position
			let argumentIndex = splitByArguments(lineTillPosition).length - 2 // remove 1 cause of length to index conversion and 1 for command
			outputChannelForDebugging.appendLine("Providing smart autocomplete for " + firstWord + " at argument index " + argumentIndex)
			var macroArgumentCount = argumentsForMacroAtPositionInDocument(document.getText(), position.line);
			if(firstWord != null) {
				// Checks for command specific completions
				if(labelCompletions[firstWord] && labelCompletions[firstWord].includes(argumentIndex)) {
					completions.push(...keywords.filter(x => x.canBeLabelInFileHere(macroArgumentCount)))
				}
				if(variableCompletions[firstWord] && variableCompletions[firstWord].includes(argumentIndex)) {
					completions.push(...keywords.filter(x => x.canBeVariableHere(macroArgumentCount)))
				}
			}
			let range = document.getWordRangeAtPosition(position, /[^ ]+/);
			let completionItems = completions.map(x => x.toCompletionItem());
			completionItems.forEach(x => x.range = range);
			// Check if label completion is needed
			return completionItems;
		}
	},     ...[' ', '#', '$', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '*', ';', ':'] // List all characters you want to trigger completions on
)
	const hoverProvider = vscode.languages.registerHoverProvider('cebrainfuck', {
        provideHover(document, position, token) {
            const range = document.getWordRangeAtPosition(position, /[^ ]+/);
            const word = document.getText(range);
			
            // Define hover content based on the hovered word
			let keywords = AnalyzeDocument(document);
			let keyword = keywords.find(x => x.label == word)
			if(keyword == undefined) return undefined
			let markdownString: vscode.MarkdownString = new vscode.MarkdownString();
			markdownString.appendCodeblock(keyword.detail ?? "", "cebrainfuck");;
			markdownString.appendText(keyword.documentation?.toString() ?? "");
			return new vscode.Hover(markdownString);
        }
    });
	const definitionProvider = vscode.languages.registerDefinitionProvider('cebrainfuck', { // your language ID
        provideDefinition(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken) {
            const range = document.getWordRangeAtPosition(position, /[^ ]+/);
            const word = document.getText(range);
			let keywords = AnalyzeDocument(document);
			let keyword = keywords.find(x => x.label == word)
			if(keyword == undefined) return null
			return keyword.definition;
        }
    });
	const disposable = vscode.commands.registerCommand('brainfuckhelper.showMemory', async () => {
		const editor = vscode.window.activeTextEditor;

        if (editor) {
			outputChannel.clear()
            let document = editor.document;

            // Get the document text
            const documentText = document.getText();

			var memory = new Uint8Array(0xFFFF);

			var brainfuck = documentText
			var lastInput = 0
			var pointer = 0
			var programPosition = 0
			var lastLoopOpen: number[] = []
			memory = new Uint8Array(0xFFFF);
			var output = ""
			var input = ""
			var length = 30
			var wait = 0
			var timeout = 20000
			documentText.split("\n").forEach(e => {
				if(e.startsWith("input:")) {
					input = e.substring(6, e.length)
				}
				if(e.startsWith("debug:")) {
					length = parseInt(e.substring(6, e.length))
				}
				if(e.startsWith("step:")) {
					wait = parseInt(e.substring(5, e.length))
				}
				if(e.startsWith("timeout:")) {
					timeout = parseInt(e.substring(8, e.length))
				}
			})
			outputChannel.show()
			var startTime = Date.now();
			outputChannel.append("Starting execution\n\n")
			while (programPosition < brainfuck.length)
			{
				if (lastLoopOpen.length >= 0 && lastLoopOpen[0] == -1 && brainfuck[programPosition] != ']' && brainfuck[programPosition] != '[')
				{
					programPosition++;
					continue;
				}
				switch (brainfuck[programPosition])
				{
					case '<': // Decrease pointer
						pointer--;
						if (pointer < 0) pointer = memory.length - 1;
						break;
					case '>': // Increase pointer right
						pointer++;
						if (pointer >= memory.length) pointer = 0;
						break;
					case '+': // Increase value
						memory[pointer]++;
						break;
					case '-': // Decrease value
						memory[pointer]--;
						break;
					case '.': // Write memory to console
						output += (String.fromCharCode(memory[pointer]));
						break;
					case '[': // Open loop
						lastLoopOpen.splice(0, 0, memory[pointer] == 0 || lastLoopOpen.length >= 1 && lastLoopOpen[0] == -1 ? -1 : programPosition);
						break;
					case ']': // Close loop
						if (memory[pointer] == 0)
						{
							lastLoopOpen.splice(0, 1);
							break;
						}
						programPosition = lastLoopOpen[0];
						lastLoopOpen.splice(0, 1);
						continue;
					case ',': // Set the memory to the inputted key
						memory[pointer] =new TextEncoder().encode(input[lastInput])[0];
						lastInput++
						break;
					case '#':
						outputChannel.append("Debug trigger (#):" + DisplayMemory(memory, pointer, length) + "\n\n")
						break;
					default:
						// Don't do anything in case there are any comments or line breaks
						break;

				}
				programPosition++;
				if(wait != 0) {
					var text = "\n" + DisplayMemory(memory, pointer, length)
					outputChannel.append(text)
					await sleep(wait)
				}
				if(Date.now() - startTime > timeout)
				{
					break; // implement timeout
				}
			}
			var m = DisplayMemory(memory, pointer, length)
			outputChannel.append("Brainfuck input:\n" + input + "\n\nBrainfuck output:\n" + output + "\n\nBrainfuck memory:\n" + m)
			if(Date.now() - startTime > timeout) {
				outputChannel.append("\n\nBrainfuck has been terminated before the code has completed execution. The timeout of " + timeout + " ms has been passed")
			}
		}
		
	});

	context.subscriptions.push(disposable, completionProvider, hoverProvider, definitionProvider, diagnosticCollection, signatureProvider);
}

function sleep(ms: number) {
	return new Promise(resolve => setTimeout(resolve, ms));
  }

function DisplayMemory(memory: Uint8Array, pointer: number, length = 30) {
	var m = ""
	for(let i = 0; i < length; i++)
	{
		if(i % 10 == 0) m += "\n" + i.toString().padEnd(5) + ":       " 
		if(i == pointer) {
			m += "|>" + memory[i].toString().padEnd(3) + "<|"
		} else {
			m += "| " + memory[i].toString().padEnd(3) + " |"
		}
		
	}
	return m
}

// this method is called when your extension is deactivated
export function deactivate() {}
