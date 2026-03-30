const parser = require("@babel/parser");
const traverse = require("@babel/traverse").default;
const generate = require("@babel/generator").default;

const code = `
export default function App() {
  return (
    <body>
       {process.env.NODE_ENV === 'development' && <Script src="http://localhost:8080/onlook-preload-script.js" />}
    </body>
  )
}
`;

const ast = parser.parse(code, { plugins: ["jsx"] });
traverse(ast, {
    JSXElement(path) {
        if (path.node.openingElement.name.name === "Script") {
            console.log("Found Script!");
            const parent = path.parentPath;
            if (parent.isLogicalExpression()) {
                const grandParent = parent.parentPath;
                if (grandParent.isJSXExpressionContainer()) {
                    grandParent.remove();
                    return;
                }
            }
            path.remove();
        }
    }
});
console.log(generate(ast).code);
