import ast
import sys

def test_parse():
    with open('kritical_store_mcp.py', 'r') as f:
        source = f.read()
    ast.parse(source)

def test_function_exists():
    with open('kritical_store_mcp.py', 'r') as f:
        source = f.read()
    tree = ast.parse(source)
    function_names = [node.name for node in ast.walk(tree) if isinstance(node, ast.FunctionDef)]
    assert 'store_stats' in function_names
    assert 'recent_turns' in function_names
    assert 'search_store' in function_names
    assert 'lens_catalog' in function_names
    assert 'run_readonly_sql' in function_names
    assert '_rows' in function_names
    assert '_lim' in function_names

if __name__ == "__main__":
    test_parse()
    test_function_exists()
    print("All tests passed")