// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import { time } from 'console';
import { TextEncoder } from 'util';
import * as vscode from 'vscode';

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
	
	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('Congratulations, your extension "brainfuckhelper" is now active!');

	// The command has been defined in the package.json file
	// Now provide the implementation of the command with registerCommand
	// The commandId parameter must match the command field in package.json
	let outputChannel = vscode.window.createOutputChannel("brainfuck")
	let disposable = vscode.commands.registerCommand('brainfuckhelper.showMemory', async () => {
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

	context.subscriptions.push(disposable);
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
