import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.module.js';

/**
 * SleekGizmo LITE (Free Version)
 * Features: Translation (Move) Only.
 * Upgrade to PRO for Rotation, Scale, and Snapping.
 */
export class SleekGizmoLite {
    constructor(scene, camera, renderer, options = {}) {
        this.scene = scene;
        this.camera = camera;
        this.renderer = renderer;

        this.config = Object.assign({
            colors: { x: 0xFF2A5F, y: 0x00E676, z: 0x2979FF, active: 0xFFFFFF },
            gap: 1.1,
            length: 0.8,
            thickness: 0.03,
            headScale: 0.15,
            bubbleSize: 0.3
        }, options);

        this.attachedObject = null;
        this.gizmoGroup = new THREE.Group();
        this.scene.add(this.gizmoGroup);

        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();
        
        // State
        this.isDragging = false;
        this.activeAxis = null;
        
        // Math Buffers (Only needed for translation)
        this._dragPlane = new THREE.Plane();
        this._startIntersection = new THREE.Vector3();
        this._startPosition = new THREE.Vector3();

        this.callbacks = { onDragStart: [], onDragEnd: [], onChange: [] };
        this._initEvents();
    }

    attach(object) {
        this.attachedObject = object;
        this.gizmoGroup.visible = !!object;
        this._buildGizmo();
        this.update();
    }

    detach() {
        this.attachedObject = null;
        this.gizmoGroup.visible = false;
    }

    on(event, callback) {
        const name = 'on' + event.charAt(0).toUpperCase() + event.slice(1);
        if (this.callbacks[name]) this.callbacks[name].push(callback);
    }

    update() {
        if (!this.attachedObject || !this.gizmoGroup.visible) return;
        this.gizmoGroup.position.copy(this.attachedObject.position);
        this.gizmoGroup.quaternion.copy(this.attachedObject.quaternion);
        
        const dist = this.camera.position.distanceTo(this.attachedObject.position);
        const scale = dist * 0.09;
        this.gizmoGroup.scale.set(scale, scale, scale);

        if (!this.isDragging) this._updateVisuals();
    }

    dispose() {
        this.scene.remove(this.gizmoGroup);
        this._removeEvents();
    }

    // --- Internal Logic ---

    _initEvents() {
        this._handleDown = this._handleDown.bind(this);
        this._handleMove = this._handleMove.bind(this);
        this._handleUp = this._handleUp.bind(this);
        const el = this.renderer.domElement;
        el.addEventListener('mousedown', this._handleDown);
        el.addEventListener('touchstart', this._handleDown, { passive: false });
        window.addEventListener('mousemove', this._handleMove);
        window.addEventListener('touchmove', this._handleMove, { passive: false });
        window.addEventListener('mouseup', this._handleUp);
        window.addEventListener('touchend', this._handleUp);
    }

    _removeEvents() {
        const el = this.renderer.domElement;
        el.removeEventListener('mousedown', this._handleDown);
        el.removeEventListener('touchstart', this._handleDown);
        window.removeEventListener('mousemove', this._handleMove);
        window.removeEventListener('touchmove', this._handleMove);
        window.removeEventListener('mouseup', this._handleUp);
        window.removeEventListener('touchend', this._handleUp);
    }

    _trigger(event) { this.callbacks[event].forEach(cb => cb()); }

    _handleDown(e) {
        if (!this.attachedObject || !this.gizmoGroup.visible) return;
        const { x, y } = this._getEventPos(e);
        this.mouse.x = (x / window.innerWidth) * 2 - 1;
        this.mouse.y = -(y / window.innerHeight) * 2 + 1;
        this.raycaster.setFromCamera(this.mouse, this.camera);
        const intersects = this.raycaster.intersectObjects(this.gizmoGroup.children, true);

        if (intersects.length > 0) {
            let obj = intersects[0].object;
            while(obj && !obj.userData.axis && obj.parent) obj = obj.parent;
            if (obj && obj.userData.axis) {
                if(e.type === 'touchstart') e.preventDefault();
                this._startDrag(obj.userData.axis, x, y);
            }
        }
    }

    _startDrag(axis, x, y) {
        this.isDragging = true;
        this.activeAxis = axis;
        this._highlightAxis(axis);
        this._trigger('onDragStart');

        // Setup Translation Math
        const normal = new THREE.Vector3();
        this.camera.getWorldDirection(normal);
        this._dragPlane.setFromNormalAndCoplanarPoint(normal, this.attachedObject.position);
        
        this._startPosition.copy(this.attachedObject.position);
        
        const intersection = new THREE.Vector3();
        this.raycaster.ray.intersectPlane(this._dragPlane, intersection);
        this._startIntersection.copy(intersection);
    }

    _handleMove(e) {
        if (!this.isDragging) return;
        if(e.type === 'touchmove') e.preventDefault();
        const { x, y } = this._getEventPos(e);
        this.mouse.x = (x / window.innerWidth) * 2 - 1;
        this.mouse.y = -(y / window.innerHeight) * 2 + 1;
        this.raycaster.setFromCamera(this.mouse, this.camera);

        // Move Logic Only
        const current = new THREE.Vector3();
        if (this.raycaster.ray.intersectPlane(this._dragPlane, current)) {
            const delta = new THREE.Vector3().subVectors(current, this._startIntersection);
            const axisVec = this._getAxisVector(this.activeAxis).normalize();
            const amount = delta.dot(axisVec);
            this.attachedObject.position.copy(this._startPosition).add(axisVec.multiplyScalar(amount));
        }
        
        this._trigger('onChange');
    }

    _handleUp() {
        if(this.isDragging) {
            this.isDragging = false;
            this.activeAxis = null;
            this._resetColors();
            this._trigger('onDragEnd');
        }
    }

    _getEventPos(e) { return { x: e.changedTouches ? e.changedTouches[0].clientX : e.clientX, y: e.changedTouches ? e.changedTouches[0].clientY : e.clientY }; }
    _getAxisVector(axis) { const v = new THREE.Vector3(axis==='x'?1:0, axis==='y'?1:0, axis==='z'?1:0); return v.applyQuaternion(this.attachedObject.quaternion); }

    _buildGizmo() {
        // Only builds Arrows (Translation)
        while(this.gizmoGroup.children.length > 0) this.gizmoGroup.remove(this.gizmoGroup.children[0]);
        this.gizmoGroup.add(new THREE.Mesh(new THREE.SphereGeometry(0.2), new THREE.MeshBasicMaterial({color: 0xffffff, transparent:true, opacity:0.1, depthTest:false})));
        const c = this.config.colors;
        this._addHandle('x', c.x, [0,0,-Math.PI/2]); 
        this._addHandle('y', c.y, [0,0,0]); 
        this._addHandle('z', c.z, [Math.PI/2,0,0]);
    }

    _addHandle(axis, color, rot) {
        const mat = new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true });
        const grp = new THREE.Group();
        const stick = new THREE.Mesh(new THREE.CylinderGeometry(this.config.thickness, this.config.thickness, this.config.length), mat);
        stick.position.y = this.config.gap + this.config.length/2; stick.renderOrder = 999;
        const head = new THREE.Mesh(new THREE.ConeGeometry(this.config.headScale, this.config.headScale*2.5), mat);
        head.position.y = this.config.gap + this.config.length; head.renderOrder = 999;
        const hit = new THREE.Mesh(new THREE.CylinderGeometry(this.config.bubbleSize, this.config.bubbleSize, this.config.length+0.5), new THREE.MeshBasicMaterial({visible:false}));
        hit.position.y = this.config.gap + this.config.length/2; hit.userData = { axis };
        grp.add(stick, head, hit); grp.rotation.set(...rot); grp.userData = { axis, type: 'handle', baseColor: color };
        this.gizmoGroup.add(grp);
    }

    _updateVisuals() {
        const inv = this.gizmoGroup.quaternion.clone().invert();
        const cam = this.camera.position.clone().sub(this.gizmoGroup.position).applyQuaternion(inv);
        this.gizmoGroup.children.forEach(g => {
            if (g.userData.type === 'handle') {
                const axis = g.userData.axis;
                const flip = (axis==='x'&&cam.x<-0.2) || (axis==='y'&&cam.y<-0.2) || (axis==='z'&&cam.z<-0.2);
                g.scale.y = flip ? -1 : 1;
            }
        });
    }

    _highlightAxis(axis) { this.gizmoGroup.children.forEach(g => { if(g.userData.axis === axis) this._colorRecursive(g, this.config.colors.active); }); }
    _resetColors() { this.gizmoGroup.children.forEach(g => { if(g.userData.baseColor) this._colorRecursive(g, g.userData.baseColor); }); }
    _colorRecursive(obj, col) { if(obj.material && obj.userData.axis === undefined) obj.material.color.setHex(col); if(obj.children) obj.children.forEach(c => this._colorRecursive(c, col)); }
}