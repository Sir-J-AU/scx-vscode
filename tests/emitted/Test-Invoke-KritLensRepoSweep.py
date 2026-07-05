import ast
import sys

def test_parse_invokekritlensreposweep():
    with open('Invoke-KritLensRepoSweep.py', 'r', encoding='utf-8') as f:
        source = f.read()
    ast.parse(source)

def test_contains_audit_function():
    with open('Invoke-KritLensRepoSweep.py', 'r', encoding='utf-8') as f:
        source = f.read()
    tree = ast.parse(source)
    function_names = [node.name for node in ast.walk(tree) if isinstance(node, ast.FunctionDef)]
    assert 'audit' in function_names

def test_contains_main_flow():
    with open('Invoke-KritLensRepoSweep.py', 'r', encoding='utf-8') as f:
        source = f.read()
    tree = ast.parse(source)
    function_names = [node.name for node in ast.walk(tree) if isinstance(node, ast.FunctionDef)]
    assert 'sha' in function_names
    assert 'store_lens' in function_names
    assert 'store_bug' in function_names