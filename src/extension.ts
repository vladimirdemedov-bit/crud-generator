import * as vscode from 'vscode';

/*
* Получает строку от пользователя для дальнейшего парсинга
* 
* @return выделенная или введеная строку с описанием сущности
* @throws showErrorMessage('No active editor added') если нет активного редактора
*/

async function getInput(): Promise<string> {
	const editor = vscode.window.activeTextEditor;

	if (!editor) {
		vscode.window.showErrorMessage('No active editor added');
		return '';
	}

	const selection = editor.selection;

	if (!selection.isEmpty) {
		const selectedText = editor.document.getText(selection);
		return selectedText;
	}

	const input = await vscode.window.showInputBox({
		prompt: 'Опишите вашу сущность',
		placeHolder: 'EntityName field1:type1 field2:type2'
	});

	if (!input) {
		return '';
	}

	return input;
}

/*
* Парсит (разбивает) строку для дальнейшей работы 
* 
* @param строка с описанием сущности
* @return объект с тремя полями: тип сущности, название сущности и массив полей типа (name,type)
* @throws showErrorMessage('No active editor added') если нет активного редактора
*/

function parseInput (input: string): {entityType: string, className: string, fields:{name: string, type: string}[]} {
	const parts = input.split(' ');
	const className = parts[0];
	const fields = [];
	const lastWord = parts[parts.length-1];
	let entType = "class";

	if (lastWord == "class" || lastWord == "struct") {
		entType = lastWord;
		parts.pop(); 
	}

	for (let i = 1; i < parts.length; i++) {
		const field = parts[i];
		const objParts = field.split(':');
		const fieldObj = {name: objParts[0], type: objParts[1]};
		fields.push(fieldObj);
	}

    return {entityType: entType, className: className, fields: fields};
}

/*
* Преобразует тип данных в соответствующий с++ тип
* 
* @param тип данных (string, boolean, int)
* @return преобразованный тип (std::string, bool, int)
*/

function mapType (type: string): string {
	if (type=='string') {
		return 'std::string';
	}
	if (type=='boolean') {
		return 'bool';
	}
	if (type=='int') {
		return 'int';
	}

	return type;
}

/*
* Конвертирует массив полей в строку с объявлениями переменных C++
* 
* @param массив полей типа (name, type)
* @return строка с объявлениями полей, разделенными переносами строк
*/

function fieldsConverter (fields: {name: string, type: string} []): string {
	let res = '';
	for (let i = 0; i < fields.length; i++) {
		res += "    " + mapType(fields[i].type) + " " + fields[i].name + ";" + '\n';
	}

	return res;
}

/*
* Генерирует getters/setters методы для каждого поля сущности
* 
* @param массив полей типа (name, type)
* @return строка с объявлениями getter и setter методов
*/

function generateGettersSetters(fields: { name: string, type: string }[]): string {
	let methods = '';
	for (let i = 0; i < fields.length; i++) {
		const field = fields[i];
		const fieldName = field.name;
		const capitalizedName = fieldName.charAt(0).toUpperCase() + fieldName.slice(1);
		const getter = `	${mapType(field.type)} get${capitalizedName}() const {
    	return ${field.name};
	}`; 
		const setter = `	void set${capitalizedName}(${mapType(field.type)} new${capitalizedName}) {
    	${field.name} = new${capitalizedName};
	}\n`;
		methods += getter + '\n' + setter;
	}
	return methods;
}

/*
* Генерирует код сущности на c++
* 
* @param объект с данными сущности (entityType, className, fields)
* @return строка с кодом сущности на c++
*/

function generateEntity (data: {entityType: string, className: string, fields: {name: string, type: string}[]}): string {
	const fieldsStr = fieldsConverter(data.fields);

	let methodStr = '';
	if (data.entityType == "class") {
		methodStr = generateGettersSetters(data.fields);
	}

	let entityTemplate;

	if (data.entityType == "struct") {
		entityTemplate = `struct ${data.className} {
public:
${fieldsStr}};`;
	} else {
		entityTemplate = `class ${data.className} {
private:
${fieldsStr}
public:
${methodStr}
};`;
	}

	return entityTemplate;
}

/*
* Генерирует CRUD-репозиторий для управления сущностями
* 
* @param объект с данными сущности (entityType, className, fields)
* @return строка с кодом репозитория на c++
*/

function generateRepository(data: {entityType: string, className: string, fields: {name: string, type: string}[]}): string {
	let repositoryTemplate;
	const fieldName = data.fields[0].name;
	const capitalizedName = fieldName.charAt(0).toUpperCase() + fieldName.slice(1);
	let condition;
	if (data.entityType === "class") {
    	condition = `items[i].get${capitalizedName}()`;
	} else {
    	condition = `items[i].${fieldName}`;
}
	repositoryTemplate = `class ${data.className}Repository {
private:
    std::vector<${data.className}> items;

public:
    void create(const ${data.className}& item) {
    	items.push_back(item);
	}

	${data.className}* readBy${capitalizedName}(${mapType(data.fields[0].type)} ${fieldName}) {
        for (size_t i = 0; i < items.size(); i++) {
            if (${condition} == ${fieldName}) {
                return &items[i];
            }
        }
        return nullptr;
    }

	std::vector<${data.className}> readAll() const {
    	return items;
	}

	void updateBy${capitalizedName}(${mapType(data.fields[0].type)} ${fieldName}, const ${data.className}& newItem) {
    	for (size_t i = 0; i < items.size(); i++) {
        	if (${condition} == ${fieldName}) {
            	items[i] = newItem;
            	return;
        	}
    	}
	}

    void deleteBy${capitalizedName}(${mapType(data.fields[0].type)} ${fieldName}) {
        for (size_t i = 0; i < items.size(); i++) {
            if (${condition} == ${fieldName}) {
                items.erase(items.begin() + i);
                return;
            }
        }
    }
};`;
	return repositoryTemplate;
}

/*
* Добавляет недостающие #include библиотеки в файл
* 
* @param активный текстовый редактор vs Code
* @return сгенерированный код
* @throws Error если не удалось добавить инклуды
*/

async function addMissingIncludes(editor: vscode.TextEditor, res: string): Promise<void> {
    const document = editor.document;
    const includes: string[] = [];
    let lastIncludeLine = -1;

    for (let i = 0; i < document.lineCount; i++) {
		const lineText = document.lineAt(i).text.trim();
        if (lineText.startsWith('#include')) {
			lastIncludeLine = i;
    		const splitedLine = lineText.split(' ');
    		if (splitedLine[1]) {
        		includes.push(splitedLine[1].slice(1,-1));
    		}
		}
	}

	const neededIncludes = ['vector', 'string'];
    const missingIncludes = neededIncludes.filter(lib => !includes.includes(lib));

    if (missingIncludes.length > 0) {
        const includesText = missingIncludes.map(lib => `#include <${lib}>`).join('\n') + '\n\n';
        const insertLine = lastIncludeLine >= 0 ? lastIncludeLine + 1 : 0;
        const position = new vscode.Position(insertLine, 0);
        
        await editor.edit(editBuilder => {
            editBuilder.insert(position, includesText);
        });
    }
}

/*
* Инициализирует плагин и запускает его
* 
* @param контекст расширения vs code
*/
		
export function activate(context: vscode.ExtensionContext) {

	console.log('Congratulations, your extension "crud-generator" is now active!');

	const disposable = vscode.commands.registerCommand('crud-generator.generateCRUD', async () => {
		const text = await getInput();
		if (text == '') {
			vscode.window.showErrorMessage('вы отменили ввод');
			return '';	
		}
		const data = parseInput(text);
		const entityCode = generateEntity(data);
		const repoCode = generateRepository(data);
		const res = entityCode + '\n\n' + repoCode;
		const editor = vscode.window.activeTextEditor;
		if (editor) {
			await addMissingIncludes(editor, res);
    		const selection = editor.selection;
    
    		editor.edit(editBuilder => {
        		editBuilder.replace(selection, res);
    	});
		}
	});

	context.subscriptions.push(disposable);
}

export function deactivate() {}