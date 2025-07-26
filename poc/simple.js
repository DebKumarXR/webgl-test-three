import {
	WebGLRenderer,
	PCFSoftShadowMap,
	Scene,
	DirectionalLight,
	AmbientLight,
	PerspectiveCamera,
	BoxGeometry,
	DoubleSide,
	FrontSide,
	Mesh,
	BufferGeometry,
	MeshStandardMaterial,
	MeshBasicMaterial,
	SphereGeometry,
	MathUtils,
	CylinderGeometry,
	TorusGeometry,
	TorusKnotGeometry,
	BufferAttribute,
} from 'three';
import * as THREE from 'three';
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { DecalGeometry } from 'three/examples/jsm/geometries/DecalGeometry.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { MeshBVHVisualizer } from 'three-mesh-bvh';
import {
	Brush,
	Evaluator,
	EdgesHelper,
	TriangleSetHelper,
	logTriangleDefinitions,
	GridMaterial,
	ADDITION,
	SUBTRACTION,
	REVERSE_SUBTRACTION,
	INTERSECTION,
	DIFFERENCE,
	HOLLOW_INTERSECTION,
	HOLLOW_SUBTRACTION,
} from '..';

window.logTriangleDefinitions = logTriangleDefinitions;

const params = {

	brush1Shape: 'box',
	brush1Complexity: 1,
	brush1Color: '#ffffff',

	brush2Shape: 'sphere',
	brush2Complexity: 1,
	brush2Color: '#E91E63',

	operation: SUBTRACTION,
	wireframe: false,
	displayBrushes: true,
	displayControls: true,
	shadows: false,
	vertexColors: false,
	flatShading: false,
	gridTexture: false,
	useGroups: true,

	enableDebugTelemetry: true,
	displayIntersectionEdges: false,
	displayTriangleIntersections: false,
	displayBrush1BVH: false,
	displayBrush2BVH: false,

	minScale: 10,
	maxScale: 20,
	rotate: true,
	clear: function () {
		removeDecal();
	}

};

let renderer, camera, scene, gui, outputContainer;
let controls, transformControls;
let brush1, brush2;
let resultObject, wireframeResult, light, originalMaterial;
let edgesHelper, trisHelper;
let bvhHelper1, bvhHelper2;
let needsUpdate = true;
let csgEvaluator;
// meshes
let hipGLTF;
let femurGLTF;
let hipMesh;
let femurMesh;
const materialMap = new Map();

// decals
let decalMesh;
let raycaster;
let line;

const intersection = {
	intersects: false,
	point: new THREE.Vector3(),
	normal: new THREE.Vector3()
};
const mouse = new THREE.Vector2();
const intersects = [];

const textureLoader = new THREE.TextureLoader();
const decalDiffuse = textureLoader.load( '/textures/decal/decal-diffuse.png' );
decalDiffuse.colorSpace = THREE.SRGBColorSpace;
const decalNormal = textureLoader.load( '/textures/decal/decal-normal.jpg' );

const decalMaterial = new THREE.MeshPhongMaterial( {
	specular: 0x444444,
	map: decalDiffuse,
	normalMap: decalNormal,
	normalScale: new THREE.Vector2( 1, 1 ),
	shininess: 30,
	transparent: true,
	depthTest: true,
	depthWrite: false,
	polygonOffset: true,
	polygonOffsetFactor: - 4,
	wireframe: false
} );

const decals = [];
let mouseHelper;
const position = new THREE.Vector3();
const orientation = new THREE.Euler();
const size = new THREE.Vector3( 10, 10, 10 );

init();

async function init() {

	const bgColor = 0x111111;

	outputContainer = document.getElementById( 'output' );

	// renderer setup
	renderer = new WebGLRenderer( { antialias: true } );
	renderer.setPixelRatio( window.devicePixelRatio );
	renderer.setSize( window.innerWidth, window.innerHeight );
	renderer.setAnimationLoop( animate );
	renderer.setClearColor( bgColor, 1 );
	renderer.shadowMap.enabled = true;
	renderer.shadowMap.type = PCFSoftShadowMap;
	document.body.appendChild( renderer.domElement );
	
	// scene setup
	scene = new Scene();

	// lights
	light = new DirectionalLight( 0xffffff, 3.5 );
	light.position.set( -20, 2, 3 );
	scene.add( light, light.target );
	scene.add( new AmbientLight( 0xb0bec5, 0.35 ) );

	// shadows
	const shadowCam = light.shadow.camera;
	light.castShadow = false;
	light.shadow.mapSize.setScalar( 2048 );
	light.shadow.bias = 1e-5;
	light.shadow.normalBias = 1e-2;

	shadowCam.left = shadowCam.bottom = - 2.5;
	shadowCam.right = shadowCam.top = 2.5;
	shadowCam.updateProjectionMatrix();

	// camera setup
	camera = new PerspectiveCamera( 75, window.innerWidth / window.innerHeight, 0.1, 50 );
	camera.position.set( -10, 0, 4 );
	camera.far = 100;
	camera.updateProjectionMatrix();

	// controls
	controls = new OrbitControls( camera, renderer.domElement );

	transformControls = new TransformControls( camera, renderer.domElement );
	transformControls.setSize( 0.75 );
	transformControls.addEventListener( 'dragging-changed', e => {

		controls.enabled = ! e.value;

	} );
	transformControls.addEventListener( 'objectChange', () => {

		needsUpdate = true;

	} );
	scene.add( transformControls );


	
	// bunny mesh has no UVs so skip that attribute
	csgEvaluator = new Evaluator();
	csgEvaluator.attributes = [ 'position', 'normal' ];

	// initialize brushes
	brush1 = new Brush( new BoxGeometry(), new GridMaterial() );
	brush2 = new Brush( new BoxGeometry(), new GridMaterial() );
	//brush2.position.set( - 0.75, 0.75, 0 );
	brush2.scale.setScalar( 0.5 );
	brush1.scale.setScalar( 0.5 );

	updateBrush( brush1, params.brush1Shape, params.brush1Complexity );
	updateBrush( brush2, params.brush2Shape, params.brush2Complexity );

	// initialize materials
	brush1.material.opacity = 0.15;
	brush1.material.transparent = true;
	brush1.material.depthWrite = false;
	brush1.material.polygonOffset = true;
	brush1.material.polygonOffsetFactor = 0.2;
	brush1.material.polygonOffsetUnits = 0.2;
	brush1.material.side = DoubleSide;
	brush1.material.premultipliedAlpha = true;

	brush2.material.opacity = 0.15;
	brush2.material.transparent = true;
	brush2.material.depthWrite = false;
	brush2.material.polygonOffset = true;
	brush2.material.polygonOffsetFactor = 0.2;
	brush2.material.polygonOffsetUnits = 0.2;
	brush2.material.side = DoubleSide;
	brush2.material.premultipliedAlpha = true;
	brush2.material.roughness = 0.25;
	brush2.material.color.set( 0xE91E63 );

	brush1.receiveShadow = true;
	brush2.receiveShadow = true;
	transformControls.attach( brush2 );

	scene.add( brush1, brush2 );

	// create material map for transparent to opaque variants
	let mat;
	mat = brush1.material.clone();
	mat.side = FrontSide;
	mat.opacity = 1;
	mat.transparent = false;
	mat.depthWrite = true;
	materialMap.set( brush1.material, mat );

	mat = brush2.material.clone();
	mat.side = FrontSide;
	mat.opacity = 1;
	mat.transparent = false;
	mat.depthWrite = true;
	materialMap.set( brush2.material, mat );

	materialMap.forEach( ( m1, m2 ) => {

		m1.enableGrid = params.gridTexture;
		m2.enableGrid = params.gridTexture;

	} );

	// add object displaying the result
	resultObject = new Mesh( new BufferGeometry(), new MeshStandardMaterial( {
		flatShading: false,
		polygonOffset: true,
		polygonOffsetUnits: 0.1,
		polygonOffsetFactor: 0.1,
	} ) );
	resultObject.castShadow = true;
	resultObject.receiveShadow = true;
	originalMaterial = resultObject.material;
	scene.add( resultObject );

	// add wireframe representation
	wireframeResult = new Mesh( resultObject.geometry, new MeshBasicMaterial( {
		wireframe: true,
		color: 0,
		opacity: 0.15,
		transparent: true,
	} ) );
	scene.add( wireframeResult );

	// helpers
	edgesHelper = new EdgesHelper();
	edgesHelper.color.set( 0xE91E63 );
	scene.add( edgesHelper );

	trisHelper = new TriangleSetHelper();
	trisHelper.color.set( 0x00BCD4 );
	scene.add( trisHelper );

	bvhHelper1 = new MeshBVHVisualizer( brush1, 20 );
	bvhHelper2 = new MeshBVHVisualizer( brush2, 20 );
	scene.add( bvhHelper1, bvhHelper2 );

	bvhHelper1.update();
	bvhHelper2.update();

	// load hip geometry
	hipGLTF = await new GLTFLoader()
		.setMeshoptDecoder( MeshoptDecoder )
		.loadAsync( 'https://debkumarxr.github.io/webgl-test-three/poc/mesh/hip_MQ.glb' );

	hipMesh = hipGLTF.scene.children[ 0 ].geometry;
	hipMesh.computeVertexNormals();


	//load femur geometry
	femurGLTF = await new GLTFLoader()
		.setMeshoptDecoder( MeshoptDecoder )
		.loadAsync( 'https://debkumarxr.github.io/webgl-test-three/poc/mesh/femur_MQ.glb' );

	femurMesh = femurGLTF.scene.children[ 0 ].geometry;
	femurMesh.computeVertexNormals();

	// gui
	gui = new GUI();
	gui.add( params, 'operation', { ADDITION, SUBTRACTION, REVERSE_SUBTRACTION, INTERSECTION, DIFFERENCE, HOLLOW_INTERSECTION, HOLLOW_SUBTRACTION } ).onChange( v => {

		needsUpdate = true;

		if ( v === HOLLOW_INTERSECTION || v === HOLLOW_SUBTRACTION ) {

			materialMap.forEach( m => m.side = DoubleSide );

		} else {

			materialMap.forEach( m => m.side = FrontSide );

		}

	} );
	gui.add( params, 'displayBrushes' );
	gui.add( params, 'displayControls' );
	gui.add( params, 'shadows' );
	gui.add( params, 'useGroups' ).onChange( () => needsUpdate = true );
	gui.add( params, 'vertexColors' ).onChange( v => {

		brush1.material.vertexColors = v;
		brush1.material.needsUpdate = true;

		brush2.material.vertexColors = v;
		brush2.material.needsUpdate = true;

		materialMap.forEach( m => {

			m.vertexColors = v;
			m.needsUpdate = true;

		} );

		csgEvaluator.attributes = v ?
			[ 'color', 'position', 'normal' ] :
			[ 'position', 'normal' ];

		needsUpdate = true;

	} );
	gui.add( params, 'gridTexture' ).onChange( v => {

		materialMap.forEach( ( m1, m2 ) => {

			m1.enableGrid = v;
			m2.enableGrid = v;

		} );

	} );
	gui.add( params, 'flatShading' ).onChange( v => {

		brush1.material.flatShading = v;
		brush1.material.needsUpdate = true;

		brush2.material.flatShading = v;
		brush2.material.needsUpdate = true;

		materialMap.forEach( m => {

			m.flatShading = v;
			m.needsUpdate = true;

		} );

	} );

	const brush1Folder = gui.addFolder( 'brush 1' );
	brush1Folder.add( params, 'brush1Shape', [ 'sphere', 'box', 'cylinder', 'torus', 'torus knot', 'mesh' ] ).name( 'shape' ).onChange( v => {

		updateBrush( brush1, v, params.brush1Complexity, hipMesh );
		bvhHelper1.update();

	} );
	brush1Folder.add( params, 'brush1Complexity', 0, 2 ).name( 'complexity' ).onChange( v => {

		updateBrush( brush1, params.brush1Shape, v, hipMesh);
		bvhHelper1.update();

	} );
	brush1Folder.addColor( params, 'brush1Color' ).onChange( v => {

		brush1.material.color.set( v );
		materialMap.get( brush1.material ).color.set( v );

	} );

	const brush2Folder = gui.addFolder( 'brush 2' );
	brush2Folder.add( params, 'brush2Shape', [ 'sphere', 'box', 'cylinder', 'torus', 'torus knot', 'mesh' ] ).name( 'shape' ).onChange( v => {

		updateBrush( brush2, v, params.brush2Complexity, femurMesh );
		bvhHelper2.update();

	} );
	brush2Folder.add( params, 'brush2Complexity', 0, 2 ).name( 'complexity' ).onChange( v => {

		updateBrush( brush2, params.brush2Shape, v, femurMesh );
		bvhHelper2.update();

	} );
	brush2Folder.addColor( params, 'brush2Color' ).onChange( v => {

		brush2.material.color.set( v );
		materialMap.get( brush2.material ).color.set( v );

	} );

	const debugFolder = gui.addFolder( 'debug' );
	debugFolder.add( params, 'enableDebugTelemetry' ).onChange( () => needsUpdate = true );
	debugFolder.add( params, 'displayIntersectionEdges' );
	debugFolder.add( params, 'displayTriangleIntersections' );
	debugFolder.add( params, 'wireframe' );
	debugFolder.add( params, 'displayBrush1BVH' );
	debugFolder.add( params, 'displayBrush2BVH' );

	// default rotate
	transformControls.setMode( 'rotate' );

	window.addEventListener( 'resize', function () {

		camera.aspect = window.innerWidth / window.innerHeight;
		camera.updateProjectionMatrix();

		renderer.setSize( window.innerWidth, window.innerHeight );

	}, false );

	window.addEventListener( 'keydown', function ( e ) {

		switch ( e.code ) {

			case 'KeyW':
				transformControls.setMode( 'translate' );
				break;
			case 'KeyE':
				transformControls.setMode( 'rotate' );
				break;
			case 'KeyR':
				transformControls.setMode( 'scale' );
				break;

		}

	} );

	gui.add( params, 'minScale', 1, 30 );
	gui.add( params, 'maxScale', 1, 30 );
	gui.add( params, 'rotate' );
	gui.add( params, 'clear' );
	initDecal();

	render();

}

function updateBrush( brush, type, complexity, mesh ) {

	brush.geometry.dispose();
	switch ( type ) {

		case 'sphere':
			brush.geometry = new SphereGeometry(
				1,
				Math.round( MathUtils.lerp( 5, 32, complexity ) ),
				Math.round( MathUtils.lerp( 5, 16, complexity ) )
			);
			break;
		case 'box':
			const dim = Math.round( MathUtils.lerp( 1, 10, complexity ) );
			brush.geometry = new BoxGeometry( 1, 1, 1, dim, dim, dim );
			break;
		case 'cylinder':
			brush.geometry = new CylinderGeometry(
				0.5, 0.5, 1,
				Math.round( MathUtils.lerp( 5, 32, complexity ) ),
			);
			break;
		case 'torus':
			brush.geometry = new TorusGeometry(
				0.6,
				0.2,
				Math.round( MathUtils.lerp( 4, 16, complexity ) ),
				Math.round( MathUtils.lerp( 6, 30, complexity ) )
			);
			break;
		case 'torus knot':
			brush.geometry = new TorusKnotGeometry(
				0.6,
				0.2,
				Math.round( MathUtils.lerp( 16, 64, complexity ) ),
				Math.round( MathUtils.lerp( 4, 16, complexity ) ),
			);
			break;
		case 'mesh':
			brush.geometry = mesh.clone();
			break;

	}

	brush.geometry = brush.geometry.toNonIndexed();

	const position = brush.geometry.attributes.position;
	const array = new Float32Array( position.count * 3 );
	for ( let i = 0, l = array.length; i < l; i += 9 ) {

		array[ i + 0 ] = 1;
		array[ i + 1 ] = 0;
		array[ i + 2 ] = 0;

		array[ i + 3 ] = 0;
		array[ i + 4 ] = 1;
		array[ i + 5 ] = 0;

		array[ i + 6 ] = 0;
		array[ i + 7 ] = 0;
		array[ i + 8 ] = 1;

	}

	brush.geometry.setAttribute( 'color', new BufferAttribute( array, 3 ) );
	brush.prepareGeometry();
	needsUpdate = true;

}

function render() {

	requestAnimationFrame( render );

	//brush2.scale.x = Math.max( brush2.scale.x, 0.01 );
	//brush2.scale.y = Math.max( brush2.scale.y, 0.01 );
	//brush2.scale.z = Math.max( brush2.scale.z, 0.01 );

	const enableDebugTelemetry = params.enableDebugTelemetry;
	if ( needsUpdate ) {

		needsUpdate = false;

		brush1.updateMatrixWorld();
		brush2.updateMatrixWorld();

		const startTime = window.performance.now();
		csgEvaluator.debug.enabled = enableDebugTelemetry;
		csgEvaluator.useGroups = params.useGroups;
		csgEvaluator.evaluate( brush1, brush2, params.operation, resultObject );

		if ( params.useGroups ) {

			resultObject.material = resultObject.material.map( m => materialMap.get( m ) );

		} else {

			resultObject.material = originalMaterial;

		}

		const deltaTime = window.performance.now() - startTime;
		outputContainer.innerText = `${ deltaTime.toFixed( 3 ) }ms`;

		if ( enableDebugTelemetry ) {

			edgesHelper.setEdges( csgEvaluator.debug.intersectionEdges );

			trisHelper.setTriangles( [
				...csgEvaluator.debug.triangleIntersectsA.getTrianglesAsArray(),
				...csgEvaluator.debug.triangleIntersectsA.getIntersectionsAsArray()
			] );

		}
		// // get vertex positions of hip mesh
		// if ( testMesh === undefined ) return;
		// const positionsHip = testMesh.geometry.attributes.position;
		// //convert object to world space
		// positionsHip.applyMatrix4( testMesh.matrixWorld );
		// //print vertex positions
		// console.log( 'hip mesh vertex positions:', positionsHip.array );

		// for ( let i = 0; i < 5; i++ ) {
		// 	const position = new THREE.Vector3().fromBufferAttribute( positionsHip, i );
		// 	// add decal at position
		// 	addDecal( position );
		// }

		// const positions = resultObject.geometry.attributes.position;
		// //convert object to world space
		// positions.applyMatrix4( resultObject.matrixWorld );
		// //print vertex positions
		// console.log( 'result object vertex positions:', positions.array );

		// // add decals for 5 vertices positions
		// for ( let i = 0; i < 5; i++ ) {
		// 	const position = new THREE.Vector3().fromBufferAttribute( positions, i );
		// 	// add decal at position
		// 	addDecal( position );
		// }

	}

	// window.CSG_DEBUG = csgEvaluator.debug;
	// if ( window.TRI !== undefined ) {

	// 	const v = Object.keys( csgEvaluator.debug.triangleIntersectsA.data )[ window.TRI ];
	// 	const _matrix = new Matrix4();
	// 	_matrix
	// 		.copy( brush2.matrixWorld )
	// 		.invert()
	// 		.multiply( brush1.matrixWorld );


	// 	// This is the space that clipping happens in
	// 	const tris = [
	// 		...csgEvaluator.debug.triangleIntersectsA.getTrianglesAsArray( v ),
	// 		...csgEvaluator.debug.triangleIntersectsA.getIntersectionsAsArray( v ),
	// 	].map( t => {

	// 		t = t.clone();
	// 		t.a.applyMatrix4( _matrix );
	// 		t.b.applyMatrix4( _matrix );
	// 		t.c.applyMatrix4( _matrix );
	// 		return t;

	// 	} );

	// 	trisHelper.setTriangles( [ ...tris ] );
	// 	logTriangleDefinitions( ...tris );

	// }

	wireframeResult.visible = params.wireframe;
	brush1.visible = params.displayBrushes;
	brush2.visible = params.displayBrushes;

	light.castShadow = params.shadows;

	transformControls.enabled = params.displayControls;
	transformControls.visible = params.displayControls;

	edgesHelper.visible = enableDebugTelemetry && params.displayIntersectionEdges;
	trisHelper.visible = enableDebugTelemetry && params.displayTriangleIntersections;

	bvhHelper1.visible = params.displayBrush1BVH;
	bvhHelper2.visible = params.displayBrush2BVH;

	//renderer.render( scene, camera );

}

// init decal
function initDecal() {
	
	const geometry = new THREE.BufferGeometry();
	geometry.setFromPoints( [ new THREE.Vector3(), new THREE.Vector3() ] );

	line = new THREE.Line( geometry, new THREE.LineBasicMaterial() );
	scene.add( line );

	loadSourceMesh();

	raycaster = new THREE.Raycaster();

	mouseHelper = new THREE.Mesh( new THREE.BoxGeometry( 1, 1, 10 ), new THREE.MeshNormalMaterial() );
	mouseHelper.visible = false;
	scene.add( mouseHelper );

	window.addEventListener( 'resize', onWindowResize );

	let moved = false;

	controls.addEventListener( 'change', function () {

		moved = true;

	} );

	window.addEventListener( 'pointerdown', function () {

		moved = false;

	} );

	window.addEventListener( 'pointerup', function ( event ) {

		if ( moved === false ) {

			checkIntersection( event.clientX, event.clientY );

			if ( intersection.intersects ) addDecal();

		}

	} );

	window.addEventListener( 'pointermove', onPointerMove );

	function onPointerMove( event ) {

		if ( event.isPrimary ) {

			checkIntersection( event.clientX, event.clientY );

		}

	}

}

function checkIntersection( x, y ) {

	if ( decalMesh === undefined ) return;

	mouse.x = ( x / window.innerWidth ) * 2 - 1;
	mouse.y = - ( y / window.innerHeight ) * 2 + 1;

	raycaster.setFromCamera( mouse, camera );
	raycaster.intersectObject( decalMesh, false, intersects );

	if ( intersects.length > 0 ) {

		const p = intersects[ 0 ].point;
		mouseHelper.position.copy( p );
		intersection.point.copy( p );

		const normalMatrix = new THREE.Matrix3().getNormalMatrix( decalMesh.matrixWorld );

		const n = intersects[ 0 ].face.normal.clone();
		n.applyNormalMatrix( normalMatrix );
		n.multiplyScalar( 10 );
		n.add( intersects[ 0 ].point );

		intersection.normal.copy( intersects[ 0 ].face.normal );
		mouseHelper.lookAt( n );

		const positions = line.geometry.attributes.position;
		positions.setXYZ( 0, p.x, p.y, p.z );
		positions.setXYZ( 1, n.x, n.y, n.z );
		positions.needsUpdate = true;

		intersection.intersects = true;

		intersects.length = 0;

	} else {

		intersection.intersects = false;

	}

}
// load glb source mesh
async function loadSourceMesh() {
	
	const loader = new GLTFLoader();

	loader.load( '/mesh/hip.glb', function ( gltf ) {

		decalMesh = gltf.scene.children[ 0 ];
		decalMesh.material = new THREE.MeshPhongMaterial( {
			specular: 0x111111,
			color: 0xaaaaaa,			
			shininess: 25
		} );

		scene.add( decalMesh );
		decalMesh.scale.multiplyScalar( 10 );

		// scle down to fit the hip mesh
		decalMesh.scale.set( 0.5, 0.5, 0.5 );

		//change position to the hip mesh
		decalMesh.position.set( 0, 10, 0 );

	} );

}

// function for adding decal on the hip mesh
function addDecal() {	

	position.copy( intersection.point );
	orientation.copy( mouseHelper.rotation );

	if ( params.rotate ) orientation.z = Math.random() * 2 * Math.PI;

	const scale = params.minScale + Math.random() * ( params.maxScale - params.minScale );
	size.set( scale, scale, scale );

	const material = decalMaterial.clone();
	material.color.setHex( Math.random() * 0xffffff );

	const m = new THREE.Mesh( new DecalGeometry( decalMesh, position, orientation, size ), material );
	m.renderOrder = decals.length; // give decals a fixed render order

	decals.push( m );

	decalMesh.attach( m );

	// if(testMesh === undefined) return;

	// const orientation = new THREE.Euler( Math.PI / 2, 0, 0 ); // rotate decal to face up
	// const size = new THREE.Vector3( 5, 5, 5 ); // size of the decal

	// const material = decalMaterial.clone();
	// material.color.setHex( Math.random() * 0xffffff );
	// const m = new THREE.Mesh( new DecalGeometry( testMesh, position, orientation, size ), material );
	// m.renderOrder = decals.length; // give decals a fixed render order

	// decals.push( m );
	// testMesh.attach( m );
}

// remove decal from the hip mesh
function removeDecal() {
	decals.forEach( function ( d ) {
		decalMesh.remove( d );
	} );
	decals.length = 0;
}

function onWindowResize() {

	camera.aspect = window.innerWidth / window.innerHeight;
	camera.updateProjectionMatrix();

	renderer.setSize( window.innerWidth, window.innerHeight );

}
function animate() {

	renderer.render( scene, camera );

//	stats.update();

}


