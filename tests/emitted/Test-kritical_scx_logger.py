import ast
import sys

def test_parse_kritical_scx_logger():
    with open('kritical_scx_logger.py', 'r', encoding='utf-8') as f:
        source = f.read()
    
    # Test that the file parses without syntax errors
    try:
        ast.parse(source)
    except SyntaxError as e:
        assert False, f"Syntax error in kritical_scx_logger.py: {e}"
    
    # Test that expected function names exist
    tree = ast.parse(source)
    function_names = [node.name for node in ast.walk(tree) if isinstance(node, ast.FunctionDef)]
    
    expected_functions = ['_dbg', '_sha', '_simhash', '_write', '_capture', 
                         'log_success_event', 'async_log_success_event']
    
    for func_name in expected_functions:
        assert func_name in function_names, f"Function {func_name} not found in module"
    
    # Test that class exists
    class_names = [node.name for node in ast.walk(tree) if isinstance(node, ast.ClassDef)]
    assert 'KriticalLogger' in class_names, "Class KriticalLogger not found in module"
    
    # Test that global variable exists
    assignments = [node for node in ast.walk(tree) if isinstance(node, ast.Assign)]
    kritical_logger_exists = any(
        isinstance(target, ast.Name) and target.id == 'kritical_logger' 
        for assign in assignments 
        for target in assign.targets
    )
    assert kritical_logger_exists, "Global variable kritical_logger not found"

if __name__ == '__main__':
    test_parse_kritical_scx_logger()
    print("All smoke tests passed!")