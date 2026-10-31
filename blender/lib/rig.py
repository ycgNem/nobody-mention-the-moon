"""The shared humanoid rig for hosts and guests (docs/TECH.md "Characters and animation").

Blender Z-up, meters. The character faces +Y (Three.js -Z), so its right side is +X: `_r` bones sit
on +X. The origin is the root bone at the feet center on the floor. Total height 1.72 m, eyes at
1.55 m, chunky storybook proportions (slightly big head).

- `create_armature()` builds the 18-bone armature object `rig` in its rest pose (an A-pose: arms
  hanging 10 degrees out from the body, legs straight, feet flat).
- `Pose` + `Solver` turn readable pose descriptions (body leans, wrist and ankle targets with a
  pole, hand and foot orientations) into per-bone rotations: forward kinematics plus two-bone IK.
- `bake_clip()` keys one rotation per bone per frame (the hips also get a location) into its own
  action on its own NLA track. The glTF exporter writes each as one animation. Nothing is keyed
  on `root` and nothing keys scale, so the client can move the root and scale bones freely.
- `socket()` adds an empty parented to a bone; it exports as a child node of that joint.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Callable

import bpy
from bpy_extras import anim_utils
from mathutils import Matrix, Quaternion, Vector

FPS = 24
RIG_NAME = "rig"

# --- Body measurements (rest pose) -----------------------------------------------------------
HIP_X = 0.092  # hip joints sit this far either side of the center line
HIP_Z = 0.90  # hip joint height (also the hips bone head)
KNEE_Z = 0.50
ANKLE_Z = 0.085
FOOT_TIP = Vector((0.0, 0.13, -0.06))  # foot bone: ankle -> ball of the foot
SPINE_Z = 1.02
CHEST_Z = 1.17
NECK_Z = 1.38
HEAD_Z = 1.47
HEAD_TOP = 1.723
SHOULDER = Vector((0.175, 0.0, 1.33))  # right shoulder joint; mirror x for the left
ARM_SPLAY = math.radians(10.0)  # rest arms hang this far out from vertical
UPPER_ARM = 0.28
FOREARM = 0.25
HAND = 0.15
EYE_Z = 1.55

# Head shape as stacked elliptical rings, top to bottom: (z, half width x, half depth y, center y).
# Shared with the hat kit so hats fit the head.
HEAD_PROFILE: list[tuple[float, float, float, float]] = [
    (z, rx * 1.06, ry * 1.06, cy)
    for z, rx, ry, cy in (
        (1.723, 0.0, 0.0, -0.005),
        (1.716, 0.045, 0.048, -0.005),
        (1.697, 0.083, 0.088, -0.004),
        (1.667, 0.107, 0.112, -0.002),
        (1.627, 0.121, 0.126, 0.0),
        (1.582, 0.126, 0.131, 0.002),
        (1.537, 0.125, 0.131, 0.006),
        (1.497, 0.119, 0.127, 0.008),
        (1.464, 0.104, 0.114, 0.008),
        (1.443, 0.075, 0.085, 0.006),
        (1.433, 0.036, 0.042, 0.004),
        (1.429, 0.0, 0.0, 0.004),
    )
]

ROOT = "root"
BONE_NAMES = [
    "root", "hips", "spine", "chest", "neck", "head",
    "upper_arm_l", "forearm_l", "hand_l", "upper_arm_r", "forearm_r", "hand_r",
    "thigh_l", "shin_l", "foot_l", "thigh_r", "shin_r", "foot_r",
]  # fmt: skip

# Two-bone IK chains: first bone -> (limb key used in Pose.reach, second bone)
IK_CHAINS = {
    "upper_arm_l": ("arm_l", "forearm_l"),
    "upper_arm_r": ("arm_r", "forearm_r"),
    "thigh_l": ("leg_l", "shin_l"),
    "thigh_r": ("leg_r", "shin_r"),
}

Vec3 = tuple[float, float, float]


def side_sign(side: str) -> float:
    """+1 for the character's right ('r', on +X), -1 for its left."""
    return 1.0 if side == "r" else -1.0


def arm_points(side: str) -> tuple[Vector, Vector, Vector, Vector]:
    """Rest shoulder, elbow, wrist and fingertip for one arm."""
    s = side_sign(side)
    shoulder = Vector((s * SHOULDER.x, SHOULDER.y, SHOULDER.z))
    down = Vector((s * math.sin(ARM_SPLAY), 0.0, -math.cos(ARM_SPLAY)))
    elbow = shoulder + down * UPPER_ARM
    wrist = elbow + down * FOREARM
    return shoulder, elbow, wrist, wrist + down * HAND


def leg_points(side: str) -> tuple[Vector, Vector, Vector, Vector]:
    """Rest hip joint, knee, ankle and ball of the foot for one leg."""
    x = side_sign(side) * HIP_X
    ankle = Vector((x, 0.0, ANKLE_Z))
    return Vector((x, 0.0, HIP_Z)), Vector((x, 0.0, KNEE_Z)), ankle, ankle + FOOT_TIP


def _layout() -> list[tuple[str, str | None, Vector, Vector, Vector]]:
    """(name, parent, head, tail, axis the bone's local Z should face)."""
    back = Vector((0.0, -1.0, 0.0))
    up = Vector((0.0, 0.0, 1.0))
    bones = [
        ("root", None, Vector((0, 0, 0)), Vector((0, 0.2, 0)), up),
        ("hips", "root", Vector((0, 0, HIP_Z)), Vector((0, 0, SPINE_Z)), back),
        ("spine", "hips", Vector((0, 0, SPINE_Z)), Vector((0, 0, CHEST_Z)), back),
        ("chest", "spine", Vector((0, 0, CHEST_Z)), Vector((0, 0, NECK_Z)), back),
        ("neck", "chest", Vector((0, 0, NECK_Z)), Vector((0, 0, HEAD_Z)), back),
        ("head", "neck", Vector((0, 0, HEAD_Z)), Vector((0, 0, HEAD_TOP)), back),
    ]
    for side in ("l", "r"):
        shoulder, elbow, wrist, tip = arm_points(side)
        bones += [
            (f"upper_arm_{side}", "chest", shoulder, elbow, back),
            (f"forearm_{side}", f"upper_arm_{side}", elbow, wrist, back),
            (f"hand_{side}", f"forearm_{side}", wrist, tip, back),
        ]
    for side in ("l", "r"):
        hip, knee, ankle, ball = leg_points(side)
        bones += [
            (f"thigh_{side}", "hips", hip, knee, back),
            (f"shin_{side}", f"thigh_{side}", knee, ankle, back),
            (f"foot_{side}", f"shin_{side}", ankle, ball, up),
        ]
    return bones


LAYOUT = _layout()
SEGMENTS: dict[str, tuple[Vector, Vector]] = {name: (head, tail) for name, _, head, tail, _ in LAYOUT}


def create_armature() -> bpy.types.Object:
    """The armature object `rig` with all 18 bones in the rest pose."""
    arm = bpy.data.armatures.new(RIG_NAME)
    arm.display_type = "STICK"
    obj = bpy.data.objects.new(RIG_NAME, arm)
    bpy.context.scene.collection.objects.link(obj)
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    for name, parent, head, tail, z_axis in LAYOUT:
        eb = arm.edit_bones.new(name)
        eb.head, eb.tail = head, tail
        eb.align_roll(z_axis)
        if parent is not None:
            eb.parent = arm.edit_bones[parent]
    bpy.ops.object.mode_set(mode="OBJECT")
    for pb in obj.pose.bones:
        pb.rotation_mode = "QUATERNION"
    return obj


# --- Posing ---------------------------------------------------------------------------------


def lean(fwd: float = 0.0, right: float = 0.0, turn: float = 0.0) -> Quaternion:
    """A rotation in the character's frame, degrees: pitch forward, tilt toward its right side,
    turn toward its right."""
    return (
        Quaternion((0.0, 0.0, 1.0), math.radians(-turn))
        @ Quaternion((0.0, 1.0, 0.0), math.radians(right))
        @ Quaternion((1.0, 0.0, 0.0), math.radians(-fwd))
    )


@dataclass
class Pose:
    """A pose in armature space. Anything left out stays at rest relative to its parent.

    offset: hips head translation from rest.
    rel:    rotation in character axes on top of the parent (use `lean`).
    world:  absolute rotation from the rest orientation, ignoring the parents (feet, a level head).
    aim:    direction the bone should point (minimal swing from where the parent carries it).
    frame:  (bone direction, local X axis direction) for a full orientation (hands).
    reach:  IK target for a limb ('arm_l', 'leg_r', ...): (wrist or ankle position, pole)
            where the pole is the direction the elbow or knee should bend toward.
    """

    offset: Vector = field(default_factory=Vector)
    rel: dict[str, Quaternion] = field(default_factory=dict)
    world: dict[str, Quaternion] = field(default_factory=dict)
    aim: dict[str, Vector] = field(default_factory=dict)
    frame: dict[str, tuple[Vector, Vector]] = field(default_factory=dict)
    reach: dict[str, tuple[Vector, Vector]] = field(default_factory=dict)


def orientation(y_axis: Vector, x_hint: Vector) -> Matrix:
    """3x3 rotation whose Y column is `y_axis` and X column is `x_hint` made orthogonal to it."""
    y = Vector(y_axis).normalized()
    x = Vector(x_hint) - y * Vector(x_hint).dot(y)
    if x.length < 1e-6:
        x = y.orthogonal()
    x.normalize()
    z = x.cross(y)
    return Matrix((x, y, z)).transposed()


def two_bone(start: Vector, target: Vector, a: float, b: float, pole: Vector) -> tuple[Vector, Vector]:
    """Middle joint and (clamped) end position for a two-bone chain reaching for `target`."""
    to = target - start
    dist = min(max(to.length, abs(a - b) + 1e-4), a + b - 1e-4)
    u = to.normalized()
    side = Vector(pole) - u * Vector(pole).dot(u)
    if side.length < 1e-6:
        side = u.orthogonal()
    side.normalize()
    cos_a = (a * a + dist * dist - b * b) / (2.0 * a * dist)
    sin_a = math.sqrt(max(0.0, 1.0 - cos_a * cos_a))
    return start + u * (a * cos_a) + side * (a * sin_a), start + u * dist


class Solver:
    """Turns a Pose into Blender pose-bone values (basis rotation and location per bone)."""

    def __init__(self, rig: bpy.types.Object) -> None:
        bones = rig.data.bones
        self.order = list(BONE_NAMES)
        self.parent = {b.name: (b.parent.name if b.parent else None) for b in bones}
        self.rest = {b.name: b.matrix_local.copy() for b in bones}
        self.rest_inv = {n: m.inverted() for n, m in self.rest.items()}
        self.length = {b.name: b.length for b in bones}
        self.posed: dict[str, Matrix] = {}

    def solve(self, pose: Pose) -> dict[str, tuple[Quaternion, Vector]]:
        posed: dict[str, Matrix] = {}
        delta: dict[str, Matrix] = {}
        out: dict[str, tuple[Quaternion, Vector]] = {}
        aims = {k: Vector(v) for k, v in pose.aim.items()}
        for name in self.order:
            parent = self.parent[name]
            rest = self.rest[name]
            rb = rest.to_3x3()
            if parent is None:
                base = rest.copy()
                dp = Matrix.Identity(3)
            else:
                base = posed[parent] @ self.rest_inv[parent] @ rest
                dp = delta[parent]

            chain = IK_CHAINS.get(name)
            if chain is not None and chain[0] in pose.reach:
                target, pole = pose.reach[chain[0]]
                start = base.translation
                mid, end = two_bone(start, Vector(target), self.length[name], self.length[chain[1]], Vector(pole))
                aims[name] = mid - start
                aims[chain[1]] = end - mid

            if name in aims:
                current = dp @ rb.col[1]
                db = current.rotation_difference(aims[name]).to_matrix() @ dp
            elif name in pose.frame:
                y_axis, x_axis = pose.frame[name]
                db = orientation(y_axis, x_axis) @ rb.transposed()
            elif name in pose.world:
                db = pose.world[name].to_matrix()
            elif name in pose.rel:
                db = dp @ pose.rel[name].to_matrix()
            else:
                db = dp.copy()

            basis_rot = rb.transposed() @ dp.transposed() @ db @ rb
            loc = Vector((0.0, 0.0, 0.0))
            if name == "hips":
                loc = base.to_3x3().transposed() @ Vector(pose.offset)
            posed[name] = base @ Matrix.Translation(loc) @ basis_rot.to_4x4()
            delta[name] = posed[name].to_3x3() @ rb.transposed()
            q = basis_rot.to_quaternion()
            q.normalize()
            out[name] = (q, loc)
        self.posed = posed
        return out

    def point(self, bone: str, rest_point: Vector) -> Vector:
        """Where a rest-pose point carried rigidly by `bone` ends up in the last solved pose."""
        return self.posed[bone] @ self.rest_inv[bone] @ Vector(rest_point)

    def axis(self, bone: str, rest_dir: Vector) -> Vector:
        return (self.posed[bone].to_3x3() @ self.rest_inv[bone].to_3x3() @ Vector(rest_dir)).normalized()


# --- Clips ----------------------------------------------------------------------------------

_LINEAR = None


def _linear() -> int:
    global _LINEAR
    if _LINEAR is None:
        _LINEAR = bpy.types.Keyframe.bl_rna.properties["interpolation"].enum_items["LINEAR"].value
    return _LINEAR


def _curves(bag, data_path: str, group: str, values: list[tuple[float, ...]]) -> None:
    n = len(values)
    for i in range(len(values[0])):
        fc = bag.fcurves.new(data_path, index=i, group_name=group)
        points = fc.keyframe_points
        points.add(n)
        co: list[float] = []
        for frame, v in enumerate(values):
            co += (float(frame), float(v[i]))
        points.foreach_set("co", co)
        points.foreach_set("interpolation", [_linear()] * n)
        fc.update()


def bake_clip(
    rig: bpy.types.Object,
    solver: Solver,
    name: str,
    frames: int,
    pose_at: Callable[[float], Pose],
    loop: bool,
) -> bpy.types.Action:
    """Key `pose_at(t)` for t = frame / frames at every frame 0..frames (24 fps) into a new action
    on its own NLA track. Loops must return the same pose at t = 0 and t = 1."""
    samples = [solver.solve(pose_at(f / frames)) for f in range(frames + 1)]
    action = bpy.data.actions.new(name)
    slot = action.slots.new(id_type="OBJECT", name=rig.name)
    bag = anim_utils.action_ensure_channelbag_for_slot(action, slot)
    for bone in solver.order:
        if bone == ROOT:
            continue
        quats = [s[bone][0].copy() for s in samples]
        for i in range(1, len(quats)):
            if quats[i].dot(quats[i - 1]) < 0.0:
                quats[i].negate()
        _curves(bag, f'pose.bones["{bone}"].rotation_quaternion', bone, [tuple(q) for q in quats])
        if bone == "hips":
            _curves(bag, f'pose.bones["{bone}"].location', bone, [tuple(s[bone][1]) for s in samples])
    action.use_frame_range = True
    action.frame_end = frames
    action.frame_start = 0
    action.use_cyclic = loop
    action["loop"] = loop  # exported as glTF animation extras

    ad = rig.animation_data or rig.animation_data_create()
    track = ad.nla_tracks.new()
    track.name = name
    strip = track.strips.new(name, 0, action)
    if strip.action_slot is None:
        strip.action_slot = slot
    ad.action = None
    return action


def socket(rig: bpy.types.Object, name: str, bone: str, location: Vector, rotation: Matrix | None = None) -> bpy.types.Object:
    """An empty parented to `bone`, placed at `location` (rest pose, armature space) with world
    orientation `rotation` (3x3, default: world axes) in the rest pose."""
    obj = bpy.data.objects.new(name, None)
    obj.empty_display_type = "PLAIN_AXES"
    obj.empty_display_size = 0.05
    bpy.context.scene.collection.objects.link(obj)
    obj.parent = rig
    obj.parent_type = "BONE"
    obj.parent_bone = bone
    b = rig.data.bones[bone]
    parent_m = rig.matrix_world @ b.matrix_local @ Matrix.Translation((0.0, b.length, 0.0))
    world = Matrix.Translation(location) @ (rotation if rotation is not None else Matrix.Identity(3)).to_4x4()
    obj.matrix_parent_inverse = Matrix.Identity(4)
    obj.matrix_basis = parent_m.inverted() @ world
    return obj
