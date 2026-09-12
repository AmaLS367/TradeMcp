"""Static quality policy for generated strategy source.

This validator provides early feedback; it is not a security boundary. The
networkless, restricted runner container is the security boundary because an
allowed package may itself expose unsafe modules or objects.
"""

from __future__ import annotations

import ast

from engine.domain.strategy.models import SourceValidation

ALLOWED_ROOT_MODULES = frozenset(
    {
        "math",
        "numpy",
        "pandas",
        "jesse",
        "typing",
        "dataclasses",
        "decimal",
        "statistics",
    }
)

BLOCKED_CALLS = frozenset(
    {
        "open",
        "exec",
        "eval",
        "compile",
        "__import__",
        "globals",
        "locals",
        "breakpoint",
        "exit",
        "quit",
        "input",
        "getattr",
        "setattr",
        "delattr",
        "vars",
    }
)

FORBIDDEN_ATTRIBUTES = frozenset(
    {
        "__subclasses__",
        "__class__",
        "__bases__",
        "__builtins__",
        "__globals__",
        "__code__",
        "__closure__",
        "__mro__",
        "__dict__",
        "__getattribute__",
    }
)

ENTRY_PAIRS = (("should_long", "go_long"), ("should_short", "go_short"))


class _StrategyVisitor(ast.NodeVisitor):
    def __init__(self) -> None:
        self.errors: list[str] = []
        self.strategy_classes: list[str] = []
        self.detected_methods: list[str] = []

    def _check_root(self, module_name: str, lineno: int) -> None:
        root = module_name.split(".")[0]
        if root not in ALLOWED_ROOT_MODULES:
            self.errors.append(
                f"Line {lineno}: import '{module_name}' is prohibited. "
                f"Allowed modules: {sorted(ALLOWED_ROOT_MODULES)}"
            )

    def visit_Import(self, node: ast.Import) -> None:
        for alias in node.names:
            self._check_root(alias.name, node.lineno)
        self.generic_visit(node)

    def visit_ImportFrom(self, node: ast.ImportFrom) -> None:
        if node.level:
            self.errors.append(f"Line {node.lineno}: relative imports are prohibited")
        elif node.module:
            self._check_root(node.module, node.lineno)
        self.generic_visit(node)

    def visit_Call(self, node: ast.Call) -> None:
        if isinstance(node.func, ast.Name) and node.func.id in BLOCKED_CALLS:
            self.errors.append(f"Line {node.lineno}: call '{node.func.id}' is prohibited")
        self.generic_visit(node)

    def visit_Attribute(self, node: ast.Attribute) -> None:
        if node.attr in FORBIDDEN_ATTRIBUTES:
            self.errors.append(f"Line {node.lineno}: access to '{node.attr}' is prohibited")
        self.generic_visit(node)

    def visit_ClassDef(self, node: ast.ClassDef) -> None:
        inherits_strategy = any(
            (isinstance(base, ast.Name) and base.id == "Strategy")
            or (isinstance(base, ast.Attribute) and base.attr == "Strategy")
            for base in node.bases
        )
        if inherits_strategy:
            self.strategy_classes.append(node.name)
            for item in node.body:
                if isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    self.detected_methods.append(item.name)
        self.generic_visit(node)


def validate_source(source_code: str) -> SourceValidation:
    if not source_code or not source_code.strip():
        return SourceValidation(valid=False, errors=("Source code is empty",))

    try:
        tree = ast.parse(source_code)
    except SyntaxError as error:
        return SourceValidation(
            valid=False,
            errors=(f"Syntax error on line {error.lineno}: {error.msg}",),
        )

    visitor = _StrategyVisitor()
    visitor.visit(tree)
    errors = list(visitor.errors)

    if not visitor.strategy_classes:
        errors.append("No class inheriting from 'Strategy' was found")
    elif len(visitor.strategy_classes) > 1:
        errors.append(
            f"Multiple strategy classes found: {visitor.strategy_classes}. Keep exactly one."
        )

    methods = set(visitor.detected_methods)
    if visitor.strategy_classes and not any(
        should in methods and go in methods for should, go in ENTRY_PAIRS
    ):
        errors.append(
            "At least one complete entry pair is required: "
            "should_long+go_long or should_short+go_short"
        )

    return SourceValidation(
        valid=not errors,
        strategy_class_name=(
            visitor.strategy_classes[0] if visitor.strategy_classes else None
        ),
        errors=tuple(errors),
        detected_methods=tuple(visitor.detected_methods),
    )
