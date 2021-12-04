# Brainfuck Helper
Helps you with Brainfuck. Mainly execution of brainfuck programs.s

## Features

Execute Brainfuck code in Visual Studio code:
- Add `#` to your code anywhere to show the current memory
- Add `step:[someNumberInMS]` to show the memory output of each step in the console. e. g. `step:100` will execute a step ~every 100ms
- Add `ìnput:[yourInput]` if you need input for your program. e. g. `input:ABCD` on the program `,.,.,.,.` will output `ABCD`
- Add `debug:[number]` to set the amount of memory adresses to be outputted. e. g. `debug: 10` will output the first 10 memory addresses (default: 30)
- Add `timeout:[milliseconds]` to set a timeout for program execution. The program wil terminate after this time (default: 20000). e. g. `timeout:50` will terminate the program after 50 milliseconds.

## The interpreter
- Supports all 8 brainfuck commands (`<>+-[],.`)
- Has 0xFFFF Adresses
- Can show you memory content any time in program by adding `#` to your code

Use the command `Execute Brainfuck` to execute your code
## Release Notes
### 0.0.1

Initial release of brainfuckhelper
