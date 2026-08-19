import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLean, parseCoq, parseIsabelle, stripComments } from '../dist/index.js';

test('declarations are found with their kind, name and line', () => {
  const source = `import Mathlib

theorem add_comm' (a b : Nat) : a + b = b + a := by
  omega

lemma helper : True := trivial

def double (n : Nat) : Nat := 2 * n
`;
  const declarations = parseLean(source, 'Main.lean');
  assert.deepEqual(
    declarations.map((d) => [d.kind, d.name, d.line]),
    [
      ['theorem', "add_comm'", 3],
      ['lemma', 'helper', 6],
      ['def', 'double', 8],
    ],
  );
});

test('a sorry in the body is detected, and only in the declaration that has it', () => {
  const source = `theorem proved : True := trivial

theorem unproved : False := by
  sorry

theorem also_proved : True := by
  trivial
`;
  const declarations = parseLean(source, 'M.lean');
  assert.deepEqual(
    declarations.filter((d) => d.hasSorryToken).map((d) => d.name),
    ['unproved'],
  );
});

test('a sorry inside a comment is not a placeholder', () => {
  const source = `-- we used to have a sorry here
theorem clean : True := trivial

/- an old proof:
   theorem x : False := by sorry
-/
theorem also_clean : True := trivial
`;
  const declarations = parseLean(source, 'M.lean');
  assert.deepEqual(declarations.filter((d) => d.hasSorryToken), []);
});

test('nested block comments are handled', () => {
  const { code } = stripComments('/- outer /- inner sorry -/ still comment -/ theorem t : True := trivial');
  assert.doesNotMatch(code, /sorry/);
  assert.match(code, /theorem t/);
});

test('an identifier containing sorry is not a placeholder', () => {
  const declarations = parseLean('theorem no_sorries_here : True := trivial\n', 'M.lean');
  assert.equal(declarations[0].hasSorryToken, false);
});

test('modifiers and attributes do not hide a declaration', () => {
  const source = `@[simp]
theorem tagged : True := trivial

private noncomputable def hidden : Nat := 0

protected lemma prot : True := trivial
`;
  const declarations = parseLean(source, 'M.lean');
  assert.deepEqual(
    declarations.map((d) => d.name),
    ['tagged', 'hidden', 'prot'],
  );
});

test('a compound declaration head does not become the name', () => {
  // Real mathlib: Mathlib/Algebra/AffineMonoid/Basic.lean. Before this was
  // handled, the declaration came out named "abbrev".
  const source = `/-- An affine monoid is a finitely generated cancellative monoid. -/
class abbrev IsAffineAddMonoid (M : Type*) [AddCommMonoid M] : Prop :=
  IsCancelAdd M, AddMonoid.FG M

@[to_additive]
class abbrev IsAffineMonoid (M : Type*) [CommMonoid M] : Prop :=
  IsCancelMul M
`;
  const declarations = parseLean(source, 'Basic.lean');
  assert.deepEqual(
    declarations.map((d) => d.name),
    ['IsAffineAddMonoid', 'IsAffineMonoid'],
  );
  assert.equal(declarations[0].kind, 'class');
});

test('an axiom is recorded as assumed, not proved', () => {
  const declarations = parseLean('axiom choice_like : True\ntheorem t : True := trivial\n', 'M.lean');
  assert.equal(declarations[0].isAxiom, true);
  assert.equal(declarations[0].kind, 'axiom');
  assert.equal(declarations[1].isAxiom, false);
});

test('a docstring is attached to the declaration below it', () => {
  const source = `/-- Theorem 10.5 of the paper. -/
theorem big_one : True := trivial
`;
  const declarations = parseLean(source, 'M.lean');
  assert.equal(declarations[0].docstring, 'Theorem 10.5 of the paper.');
});

test('indented declarations inside a proof are not counted as top level', () => {
  const source = `theorem outer : True := by
  have lemma_inner : True := trivial
  exact lemma_inner
`;
  const declarations = parseLean(source, 'M.lean');
  assert.deepEqual(
    declarations.map((d) => d.name),
    ['outer'],
  );
});

test('Coq Admitted is the placeholder and Axiom is assumed', () => {
  const source = `Theorem good : True.
Proof. exact I. Qed.

Lemma bad : False.
Proof. Admitted.

Axiom assumed : True.
`;
  const declarations = parseCoq(source, 'M.v');
  assert.deepEqual(
    declarations.map((d) => [d.name, d.hasSorryToken, d.isAxiom]),
    [
      ['good', false, false],
      ['bad', true, false],
      ['assumed', false, true],
    ],
  );
});

test('Coq comments do not create false placeholders', () => {
  const declarations = parseCoq('(* Admitted. *)\nTheorem t : True.\nProof. exact I. Qed.\n', 'M.v');
  assert.equal(declarations[0].hasSorryToken, false);
});

test('Isabelle sorry is detected', () => {
  const source = `theorem good: "True"
  by simp

lemma bad: "False"
  sorry
`;
  const declarations = parseIsabelle(source, 'M.thy');
  assert.deepEqual(
    declarations.map((d) => [d.name, d.hasSorryToken]),
    [
      ['good', false],
      ['bad', true],
    ],
  );
});
