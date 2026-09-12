"""AST Security Validator for agent-generated Jesse strategies."""

from __future__ import annotations

import ast
from dataclasses import dataclass, field
from typing import Any

ALLOWED_ROOT_MODULES = {
    "math",
    "numpy",
    "np",
    "pandas",
    "pd",
    "jesse",
    "typing",
    "dataclasses",
    "decimal",
}

BLOCKED_CALLS = {
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
}

FORBIDDEN_ATTRIBUTES = {
    "__subclasses__",
    "__class__",
    "__bases__",
    "__builtins__",
    "__globals__",
    "__code__",
    "__closure__",
    "__mro__",
}


@dataclass
class ValidationResult:
    valid: bool
    errors: list[str] = field(default_factory=list)
    strategy_class_name: str | None = None
    detected_methods: list[str] = field(default_factory=list)
    detected_hyperparameters: dict[str, Any] = field(default_factory=dict)


class StrategyASTVisitor(ast.NodeVisitor):
    def __init__(self) -> None:
        self.errors: list[str] = []
        self.strategy_class_name: str | None = None
        self.detected_methods: list[str] = []
        self.detected_hyperparameters: dict[str, Any] = {}

    def visit_Import(self, node: ast.Import) -> None:
        for alias in node.names:
            root = alias.name.split(".")[0]
            if root not in ALLOWED_ROOT_MODULES:
                self.errors.append(
                    f"Line {node.lineno}: Importing module '{alias.name}' is prohibited. "
                    f"Allowed modules: {sorted(ALLOWED_ROOT_MODULES)}"
                )
        self.generic_visit(node)

    def visit_ImportFrom(self, node: ast.ImportFrom) -> None:
        if node.module:
            root = node.module.split(".")[0]
            if root not in ALLOWED_ROOT_MODULES:
                self.errors.append(
                    f"Line {node.lineno}: Importing from '{node.module}' is prohibited. "
                    f"Allowed modules: {sorted(ALLOWED_ROOT_MODULES)}"
                )
        self.generic_visit(node)

    def visit_Call(self, node: ast.Call) -> None:
        if isinstance(node.func, ast.Name) and node.func.id in BLOCKED_CALLS:
            self.errors.append(
                f"Line {node.lineno}: Calling forbidden function '{node.func.id}'"
            )
        self.generic_visit(node)

    def visit_Attribute(self, node: ast.Attribute) -> None:
        if node.attr in FORBIDDEN_ATTRIBUTES:
            self.errors.append(
                f"Line {node.lineno}: Accessing forbidden attribute '{node.attr}'"
            )
        self.generic_visit(node)

    def visit_ClassDef(self, node: ast.ClassDef) -> None:
        is_strategy = False
        for base in node.bases:
            if isinstance(base, ast.Name) and base.id == "Strategy" or isinstance(base, ast.Attribute) and base.attr == "Strategy":
                is_strategy = True

        if is_strategy:
            self.strategy_class_name = node.name
            for item in node.body:
                if isinstance(item, ast.FunctionDef):
                    self.detected_methods.append(item.name)

        self.generic_visit(node)


def validate_strategy_source(source_code: str) -> ValidationResult:
    """Parses and validates strategy source code using Python AST."""
    if not source_code or not source_code.strip():
        return ValidationResult(valid=False, errors=["Source code is empty"])

    try:
        tree = ast.parse(source_code)
    except SyntaxError as err:
        return ValidationResult(
            valid=False,
            errors=[f"Syntax error on line {err.lineno}: {err.msg}"],
        )

    visitor = StrategyASTVisitor()
    visitor.visit(tree)

    if not visitor.strategy_class_name:
        visitor.errors.append(
            "No class inheriting from 'Strategy' found in source code."
        )

    required_methods = {"should_long", "go_long"}
    missing = required_methods - set(visitor.detected_methods)
    if missing:
        visitor.errors.append(
            f"Strategy class '{visitor.strategy_class_name}' is missing required methods: {sorted(missing)}"
        )

    return ValidationResult(
        valid=len(visitor.errors) == 0,
        errors=visitor.errors,
        strategy_class_name=visitor.strategy_class_name,
        detected_methods=visitor.detected_methods,
        detected_hyperparameters=visitor.detected_hyperparameters,
    )
