import ast
import sys

def test_parse():
    with open('Invoke-KritLensBrainBugHunt.py', 'r', encoding='utf-8') as f:
        source = f.read()
    ast.parse(source)

def test_function_names_exist():
    expected_functions = ['analyze', 'sha', 'store_lens', 'store_brain']
    with open('Invoke-KritLensBrainBugHunt.py', 'r', encoding='utf-8') as f:
        source = f.read()
    tree = ast.parse(source)
    function_names = [node.name for node in ast.walk(tree) if isinstance(node, ast.FunctionDef)]
    for func_name in expected_functions:
        assert func_name in function_names, f"Function {func_name} not found in module"