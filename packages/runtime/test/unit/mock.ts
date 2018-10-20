import { ILifecycleTask } from './../../src/templating/lifecycle';
import { PLATFORM, IContainer, IDisposable, ImmutableArray, Immutable, Writable } from '../../../kernel/src';
import {
  INodeSequence,
  ITemplate,
  IRenderContext,
  IRenderingEngine,
  TemplatePartDefinitions,
  IRenderable,
  TemplateDefinition,
  IViewFactory,
  ITargetedInstruction,
  IRenderLocation,
  IView,
  IBindScope,
  IAttach,
  IScope,
  BindingFlags,
  IDetachLifecycle,
  IAttachLifecycle,
  ICustomElementType,
  ICustomElement,
  Binding,
  BindingMode,
  IExpression,
  BindingContext,
  IElementProjector,
  InstanceProvider,
  ViewFactoryProvider,
  IObserverLocator,
  ObserverLocator,
  ViewFactory,
  If,
  Else,
  AccessMember,
  AccessScope,
  ForOfStatement,
  BindingIdentifier,
  RuntimeBehavior,
  IChangeSet,
  ITemplateDefinition,
  IResourceType,
  IAttributeDefinition,
  ICustomAttribute,
  IRenderer,
  INode,
  ExpressionKind,
  IBinding,
  ISignaler,
  Scope
} from '../../src';
import { spy } from 'sinon';
import { expect } from 'chai';

export class MockContext {
  public log: any[] = [];
}
export type ExposedContext = IRenderContext & IDisposable & IContainer;

export class MockCustomElement implements ICustomElement {
  public $isCached: boolean = false;
  public $needsMount: boolean = false;
  public $bindables: IBindScope[];
  public $attachables: IAttach[];
  public $isAttached: boolean;
  public $isBound: boolean;
  public $scope: IScope;
  public $projector: IElementProjector;
  public $context: IRenderContext;
  public $nodes: MockNodeSequence;
  public $encapsulationSource: Node;
  public $host: Node;
  public $hydrate(renderingEngine: IRenderingEngine, host: Node): void {
    this.$host = host;
    const Type = this.constructor as ICustomElementType;
    const description = Type.description;

    this.$bindables = [];
    this.$attachables = [];
    this.$isAttached = false;
    this.$isBound = false;
    this.$scope = Scope.create(this, null);

    this.$context = createMockRenderContext(renderingEngine, <ExposedContext>renderingEngine['container'], PLATFORM.emptyArray);
    const template = new MockTemplate(renderingEngine, <ExposedContext>renderingEngine['container'], description)
    this.$context = template.renderContext;

    const nodes = this.$nodes = MockNodeSequence.createSimpleMarker();
    this.$context.render(this, nodes.findTargets(), description, host);
  }

  public $bind(flags: BindingFlags): void {
    if (this.$isBound) {
      return;
    }
    const scope = this.$scope;
    const bindables = this.$bindables;
    for (let i = 0, ii = bindables.length; i < ii; ++i) {
      bindables[i].$bind(flags | BindingFlags.fromBind, scope);
    }
    this.$isBound = true;
  }

  public $unbind(flags: BindingFlags): void {
    if (this.$isBound) {
      const bindables = this.$bindables;
      let i = bindables.length;
      while (i--) {
        bindables[i].$unbind(flags | BindingFlags.fromUnbind);
      }
      this.$isBound = false;
    }
  }

  public $attach(encapsulationSource: Node, lifecycle: IAttachLifecycle): void {
    if (this.$isAttached) {
      return;
    }
    this.$encapsulationSource = encapsulationSource;
    const attachables = this.$attachables;
    for (let i = 0, ii = attachables.length; i < ii; ++i) {
      attachables[i].$attach(encapsulationSource, lifecycle);
    }
    lifecycle.queueMount(this);
    this.$isAttached = true;
  }

  public $detach(lifecycle: IDetachLifecycle): void {
    if (this.$isAttached) {
      lifecycle.queueUnmount(this);
      const attachables = this.$attachables;
      let i = attachables.length;
      while (i--) {
        attachables[i].$detach(lifecycle);
      }
      this.$isAttached = false;
    }
  }

  public $cache(): void {
    const attachables = this.$attachables;
    let i = attachables.length;
    while (i--) {
      attachables[i].$cache();
    }
  }

  public $mount(): void {
    this.$needsMount = false;
    this.$nodes.appendTo(this.$host);
    this.$mount = PLATFORM.noop;
  }

  public $unmount(): void {
    this.$needsMount = true;
  }
}

export function createMockRenderContext(
  renderingEngine: IRenderingEngine,
  parentRenderContext: IRenderContext,
  dependencies: ImmutableArray<any>): IRenderContext {

  const context = <ExposedContext>parentRenderContext.createChild();
  const renderableProvider = new InstanceProvider();
  const elementProvider = new InstanceProvider();
  const instructionProvider = new InstanceProvider<ITargetedInstruction>();
  const factoryProvider = new ViewFactoryProvider(renderingEngine);
  const renderLocationProvider = new InstanceProvider<IRenderLocation>();
  const renderer = renderingEngine.createRenderer(context);

  context.registerResolver(Node, elementProvider);
  context.registerResolver(IViewFactory, factoryProvider);
  context.registerResolver(IRenderable, renderableProvider);
  context.registerResolver(ITargetedInstruction, instructionProvider);
  context.registerResolver(IRenderLocation, renderLocationProvider);

  if (dependencies) {
    context.register(...dependencies);
  }
  context.render = function(
    renderable: IView,
    targets: ArrayLike<Node>,
    templateDefinition: TemplateDefinition,
    host?: Node,
    parts?: TemplatePartDefinitions): void {
    renderer.render(renderable, targets, templateDefinition, host, parts)
  };

  context.beginComponentOperation = function(
    renderable: IView,
    target: any,
    instruction: ITargetedInstruction,
    factory?: IViewFactory,
    parts?: TemplatePartDefinitions,
    location?: IRenderLocation): IDisposable {

    renderableProvider.prepare(renderable);
    elementProvider.prepare(target);
    instructionProvider.prepare(instruction);
    if (factory) {
      factoryProvider.prepare(factory, parts);
    }
    if (location) {
      renderLocationProvider.prepare(location);
    }
    return context;
  };
  context.dispose = function(): void {
    factoryProvider.dispose();
    renderableProvider.dispose();
    instructionProvider.dispose();
    elementProvider.dispose();
    renderLocationProvider.dispose();
  };

  return context;
}


const marker = document.createElement('au-marker');
marker.classList.add('au');
export const createMarker = marker.cloneNode.bind(marker, false);

const emptyTextNode = document.createTextNode(' ');
export const createEmptyTextNode = emptyTextNode.cloneNode.bind(emptyTextNode, false);

const renderLocation = document.createComment('au-loc');
export const createRenderLocation = renderLocation.cloneNode.bind(renderLocation, false);

export class MockNodeSequence implements INodeSequence {
  public firstChild: Node;
  public lastChild: Node;
  public childNodes: Node[];

  public fragment: DocumentFragment;

  constructor(fragment: DocumentFragment) {
    this.fragment = fragment;
    this.firstChild = fragment.firstChild;
    this.lastChild = fragment.lastChild;
    this.childNodes = PLATFORM.toArray(fragment.childNodes);
  }

  public findTargets(): ArrayLike<Node> {
    return this.fragment.querySelectorAll('.au');
  }

  public insertBefore(refNode: Node): void {
    refNode.parentNode.insertBefore(this.fragment, refNode);
  }

  public appendTo(parent: Node): void {
    parent.appendChild(this.fragment);
  }

  public remove(): void {
    const fragment = this.fragment;
    let current = this.firstChild;
    if (current.parentNode !== fragment) {
      const append = fragment.appendChild.bind(fragment);
      const end = this.lastChild;
      let next: Node;
      while (current) {
        next = current.nextSibling;
        append(current);
        if (current === end) {
          break;
        }
        current = next;
      }
    }
  }

  public static createSimpleMarker(): MockNodeSequence {
    const fragment = document.createDocumentFragment();
    const marker = createMarker();
    fragment.appendChild(marker);
    return new MockNodeSequence(fragment);
  }

  public static createRenderLocation(): MockNodeSequence {
    const fragment = document.createDocumentFragment();
    const location = createRenderLocation();
    fragment.appendChild(location);
    return new MockNodeSequence(fragment);
  }

  public static createTextBindingMarker(): MockNodeSequence {
    const fragment = document.createDocumentFragment();
    const marker = createMarker();
    const textNode = createEmptyTextNode();
    fragment.appendChild(marker);
    fragment.appendChild(textNode);
    return new MockNodeSequence(fragment);
  }
}

export class MockTextNodeSequence implements INodeSequence {
  public firstChild: Node;
  public lastChild: Node;
  public childNodes: Node[];

  public fragment: DocumentFragment;

  constructor() {
    const fragment = this.fragment = document.createDocumentFragment();
    const textNode = this.firstChild = this.lastChild = document.createTextNode('');
    fragment.appendChild(textNode);
    this.childNodes = [textNode];
  }

  public findTargets(): ArrayLike<Node> {
    return [this.firstChild];
  }

  public insertBefore(refNode: Node): void {
    refNode.parentNode.insertBefore(this.fragment, refNode);
  }

  public appendTo(parent: Node): void {
    parent.appendChild(this.fragment);
  }

  public remove(): void {
    const fragment = this.fragment;
    const textNode = this.firstChild;
    if (textNode.parentNode !== fragment) {
      fragment.appendChild(textNode);
    }
  }
}

export class MockTemplate implements ITemplate {
  public renderContext: IRenderContext;
  public template: HTMLTemplateElement;

  constructor(
    renderingEngine: IRenderingEngine,
    parentRenderContext: IRenderContext,
    public templateDefinition: TemplateDefinition) {

    this.renderContext = createMockRenderContext(renderingEngine, parentRenderContext, templateDefinition.dependencies);
    const markupOrNode = templateDefinition.template;
    if (markupOrNode instanceof Node) {
      if ((<HTMLTemplateElement>markupOrNode).content) {
        this.template = markupOrNode as any;
      } else {
        this.template = document.createElement('template');
        this.template.content.appendChild(<Node>markupOrNode);
      }
    } else {
      this.template = document.createElement('template');
      this.template.innerHTML = <string>markupOrNode;
    }
  }

  public render(renderable: Partial<IRenderable>, host?: INode, parts?: TemplatePartDefinitions): void {
    const nodes = (<Writable<IRenderable>>renderable).$nodes = new MockNodeSequence(<DocumentFragment>this.template.content.cloneNode(true));
    (<Writable<IRenderable>>renderable).$context = this.renderContext;
    this.renderContext.render(<any>renderable, nodes.findTargets(), this.templateDefinition, host, parts);
  }
}

export class MockTextNodeTemplate {
  constructor(
    public sourceExpression: any,
    public observerLocator: any
  ) {}

  public render(renderable: Partial<IRenderable>, host?: INode, parts?: TemplatePartDefinitions): void {
    const nodes = (<Writable<IRenderable>>renderable).$nodes = new MockTextNodeSequence();
    renderable.$bindables.push(new Binding(this.sourceExpression, nodes.firstChild, 'textContent', BindingMode.toView, this.observerLocator, null));
  }
}


const expressions = {
  if: new AccessMember(new AccessScope('item'), 'if'),
  else: new AccessMember(new AccessScope('item'), 'else')
};

export class MockIfTextNodeTemplate {
  constructor(
    public sourceExpression: any,
    public observerLocator: any,
    public changeSet: any
  ) {}

  public render(renderable: Partial<IRenderable>, host?: INode, parts?: TemplatePartDefinitions): void {
    const nodes = (<Writable<IRenderable>>renderable).$nodes = MockNodeSequence.createRenderLocation();

    const observerLocator = new ObserverLocator(this.changeSet, null, null, null);
    const factory = new ViewFactory(null, <any>new MockTextNodeTemplate(expressions.if, observerLocator));

    const sut = new If(this.changeSet, factory, nodes.firstChild);

    (<any>sut)['$isAttached'] = false;
    (<any>sut)['$isBound'] = false;
    (<any>sut)['$scope'] = null;

    const behavior = RuntimeBehavior.create(<any>If, sut);
    behavior.applyTo(sut, this.changeSet);

    renderable.$attachables.push(sut);
    renderable.$bindables.push(new Binding(this.sourceExpression, sut, 'value', BindingMode.toView, this.observerLocator, null));
    renderable.$bindables.push(sut);
  }
}

export class MockElseTextNodeTemplate {
  constructor(
    public sourceExpression: any,
    public observerLocator: any,
    public changeSet: any
  ) {}

  public render(renderable: Partial<IRenderable>, host?: INode, parts?: TemplatePartDefinitions): void {
    (<Writable<IRenderable>>renderable).$nodes = MockNodeSequence.createRenderLocation();

    const observerLocator = new ObserverLocator(this.changeSet, null, null, null);
    const factory = new ViewFactory(null, <any>new MockTextNodeTemplate(expressions.else, observerLocator));

    const sut = new Else(factory);

    sut.link(<any>renderable.$attachables[renderable.$attachables.length - 1]);

    (<any>sut)['$isAttached'] = false;
    (<any>sut)['$isBound'] = false;
    (<any>sut)['$scope'] = null;

    const behavior = RuntimeBehavior.create(<any>Else, <any>sut);
    behavior.applyTo(<any>sut, this.changeSet);

    renderable.$attachables.push(<any>sut);
    renderable.$bindables.push(new Binding(this.sourceExpression, sut, 'value', BindingMode.toView, this.observerLocator, null));
    renderable.$bindables.push(<any>sut);
  }
}

export class MockIfElseTextNodeTemplate {
  constructor(
    public sourceExpression: any,
    public observerLocator: any,
    public changeSet: any
  ) {}

  public render(renderable: Partial<IRenderable>, host?: INode, parts?: TemplatePartDefinitions): void {
    const ifNodes = (<Writable<IRenderable>>renderable).$nodes = MockNodeSequence.createRenderLocation();

    const observerLocator = new ObserverLocator(this.changeSet, null, null, null);
    const ifFactory = new ViewFactory(null, <any>new MockTextNodeTemplate(expressions.if, observerLocator));

    const ifSut = new If(this.changeSet, ifFactory, ifNodes.firstChild);

    (<any>ifSut)['$isAttached'] = false;
    (<any>ifSut)['$isBound'] = false;
    (<any>ifSut)['$scope'] = null;

    const ifBehavior = RuntimeBehavior.create(<any>If, ifSut);
    ifBehavior.applyTo(ifSut, this.changeSet);

    renderable.$attachables.push(ifSut);
    renderable.$bindables.push(new Binding(this.sourceExpression, ifSut, 'value', BindingMode.toView, this.observerLocator, null));
    renderable.$bindables.push(ifSut);

    const elseFactory = new ViewFactory(null, <any>new MockTextNodeTemplate(expressions.else, observerLocator));

    const elseSut = new Else(elseFactory);

    elseSut.link(<any>renderable.$attachables[renderable.$attachables.length - 1]);

    (<any>elseSut)['$isAttached'] = false;
    (<any>elseSut)['$isBound'] = false;
    (<any>elseSut)['$scope'] = null;

    const elseBehavior = RuntimeBehavior.create(<any>Else, <any>elseSut);
    elseBehavior.applyTo(<any>elseSut, this.changeSet);

    renderable.$attachables.push(<any>elseSut);
    renderable.$bindables.push(new Binding(this.sourceExpression, elseSut, 'value', BindingMode.toView, this.observerLocator, null));
    renderable.$bindables.push(<any>elseSut);
  }
}


export class LifecycleMock implements IAttach, IBindScope, ILifecycleTask {
  public $isCached: boolean = false;
  public $isAttached: boolean = false;
  public $isBound: boolean = false;

  public parent: LifecycleMock;
  private _root: LifecycleMock;
  public get root(): LifecycleMock {
    if (this._root === undefined) {
      this._root = this.parent ? this.parent.root : this;
    }
    return this._root;
  }
  private _depth: number;
  public get depth(): number {
    if (this._depth === undefined) {
      this._depth = this.parent ? this.parent.depth + 1 : 0;
    }
    return this._depth;
  }
  public index: number;
  public children: LifecycleMock[];

  public calls: [keyof LifecycleMock, number, number, ...any[]][];
  constructor(...children: LifecycleMock[]) {
    this.parent = null;
    this.index = 0;
    this.children = children;
    this.calls = [];
    for (let i = 0, ii = children.length; i < ii; ++i) {
      const child = children[i];
      child.parent = this;
      child.index = i;
    }
  }

  public $attach(encapsulationSource: Node, lifecycle: IAttachLifecycle): void {
    this.trace('$attach', encapsulationSource, lifecycle);
    const children = this.children;
    for (let i = 0, ii = children.length; i < ii; ++i) {
      children[i].$attach(encapsulationSource, lifecycle);
    }
    lifecycle.queueMount(this);
    this.$isAttached = true;
    lifecycle.queueAttachedCallback(this);
  }

  public $mount(): void {
    this.trace('$mount');
  }

  public $detach(lifecycle: IDetachLifecycle): void {
    this.trace('$detach', lifecycle);
    lifecycle.queueUnmount(this);
    const children = this.children;
    let i = children.length;
    while (i--) {
      children[i].$detach(lifecycle);
    }
    this.$isAttached = false;
    lifecycle.queueDetachedCallback(this);
  }

  public $unmount(): void {
    this.trace('$unmount');
  }

  public $cache(): void {
    this.trace('$cache');
    const children = this.children;
    for (let i = 0, ii = children.length; i < ii; ++i) {
      children[i].$cache();
    }
  }

  public $bind(flags: BindingFlags, scope: IScope): void {
    this.trace('$bind', flags, scope);
    const children = this.children;
    for (let i = 0, ii = children.length; i < ii; ++i) {
      children[i].$bind(flags, scope);
    }
    this.$isBound = true;
  }

  public $unbind(flags: BindingFlags): void {
    this.trace('$unbind', flags);
    const children = this.children;
    let i = children.length;
    while (i--) {
      children[i].$unbind(flags);
    }
    this.$isBound = false;
  }

  public attached(): void {
    this.trace('attached');
  }

  public detached(): void {
    this.trace('detached');
  }

  public asyncWorkStarted: boolean = false;
  public asyncWorkCompleted: boolean = false;
  public asyncWorkCancelled: boolean = false;
  public promise: Promise<any> = null;
  public startAsyncWork(): Promise<void> {
    this.trace('startAsyncWork');
    this.asyncWorkStarted = true;
    return this.promise || (this.promise = new Promise((resolve) => {
      setTimeout(() => {
        if (!this.asyncWorkCancelled) {
          this.completeAsyncWork();
        }
        this.finalizeAsyncWork();
        resolve();
      });
    }));
  }

  public cancelAsyncWork(): void {
    this.trace('cancelAsyncWork');
    this.asyncWorkCancelled = true;
  }

  public completeAsyncWork(): void {
    this.trace('completeAsyncWork');
    this.asyncWorkCompleted = true;
  }

  public finalizeAsyncWork(): void {
    this.trace('finalizeAsyncWork');
    this.done = true;
  }

  public done: boolean = false;
  public canCancel(): boolean {
    return !this.done;
  }
  public cancel(): void {
    this.cancelAsyncWork();
  }
  public wait(): Promise<void> {
    return this.startAsyncWork();
  }
  public registerTo(task: IAttachLifecycle | IDetachLifecycle): void {
    this.asyncWorkStarted = this.asyncWorkCancelled = this.asyncWorkCompleted = false;
    this.promise = null;
    task.registerTask(this);
    const children = this.children;
    for (let i = 0, ii = children.length; i < ii; ++i) {
      children[i].registerTo(task);
    }
  }

  public walkTopDown(fn: (mock: LifecycleMock) => void): void {
    fn(this);
    let children = this.children;
    for (let i = 0, ii = children.length; i < ii; ++i) {
      children[i].walkTopDown(fn);
    }
  }

  public walkBottomUp(fn: (mock: LifecycleMock) => void): void {
    let children = this.children;
    for (let i = 0, ii = children.length; i < ii; ++i) {
      children[i].walkBottomUp(fn);
    }
    fn(this);
  }

  public walkTopDownReverse(fn: (mock: LifecycleMock) => void): void {
    fn(this);
    let children = this.children;
    let i = children.length;
    while (i--) {
      children[i].walkTopDownReverse(fn);
    }
  }

  public walkBottomUpReverse(fn: (mock: LifecycleMock) => void): void {
    let children = this.children;
    let i = children.length;
    while (i--) {
      children[i].walkBottomUpReverse(fn);
    }
    fn(this);
  }

  public trace(fnName: keyof LifecycleMock, ...args: any[]): void {
    this.calls.push([fnName, this.depth, this.index, ...args]);
    if (this.root !== this) {
      this.root.calls.push([fnName, this.depth, this.index, ...args]);
    }
  }
}

export class MockRenderingEngine implements IRenderingEngine {
  public calls: [keyof MockRenderingEngine, ...any[]][];

  constructor(
    public elementTemplate: ITemplate,
    public viewFactory: IViewFactory,
    public renderer: IRenderer,
    public runtimeBehaviorApplicator: (type: any, instance: any) => void
  ) {
    this.calls = [];
  }

  public getElementTemplate(definition: Immutable<Required<ITemplateDefinition>>, componentType?: ICustomElementType): ITemplate {
    this.trace(`getElementTemplate`, definition, componentType);
    return this.elementTemplate;
  }

  public getViewFactory(source: Immutable<ITemplateDefinition>, parentContext?: IRenderContext): IViewFactory {
    this.trace(`getViewFactory`, source, parentContext);
    return this.viewFactory;
  }

  public createRenderer(context: IRenderContext): IRenderer {
    this.trace(`createRenderer`, context);
    return this.renderer;
  }

  public applyRuntimeBehavior(type: IResourceType<IAttributeDefinition, ICustomAttribute>, instance: ICustomAttribute): void;
  public applyRuntimeBehavior(type: ICustomElementType, instance: ICustomElement): void;
  public applyRuntimeBehavior(type: any, instance: any) {
    this.trace(`applyRuntimeBehavior`, type, instance);
    this.runtimeBehaviorApplicator(type, instance);
  }


  public trace(fnName: keyof MockRenderingEngine, ...args: any[]): void {
    this.calls.push([fnName, ...args]);
  }

}

export function defineComponentLifecycleMock() {
  return class ComponentLifecycleMock {
    public calls: [keyof ComponentLifecycleMock, ...any[]][] = [];

    constructor() {}

    public created(): void {
      this.trace(`created`);
      this.verifyPropertyValue('$isBound', false, 'created');
      this.verifyPropertyValue('$isAttached', false, 'created');
    }
    public binding(flags: BindingFlags): void {
      this.trace(`binding`, flags);
    }
    public bound(flags: BindingFlags): void {
      this.trace(`bound`, flags);
      this.verifyPropertyValue('$isBound', true, 'bound');
    }
    public attaching(encapsulationSource: INode, lifecycle: IAttachLifecycle): void {
      this.trace(`attaching`, encapsulationSource, lifecycle);
      this.verifyPropertyValue('$isBound', true, 'attaching');
      this.verifyPropertyValue('$isAttached', false, 'attaching');
    }
    public attached(): void {
      this.trace(`attached`);
      this.verifyPropertyValue('$isBound', true, 'attached');
      this.verifyPropertyValue('$isAttached', true, 'attached');
    }
    public detaching(lifecycle: IDetachLifecycle): void {
      this.trace(`detaching`, lifecycle);
      this.verifyPropertyValue('$isBound', true, 'detaching');
      this.verifyPropertyValue('$isAttached', true, 'detaching');
    }
    public detached(): void {
      this.trace(`detached`);
      this.verifyPropertyValue('$isBound', true, 'detached');
      this.verifyPropertyValue('$isAttached', false, 'detached');
    }
    public unbinding(flags: BindingFlags): void {
      this.trace(`unbinding`, flags);
      this.verifyPropertyValue('$isBound', true, 'detached');
    }
    public unbound(flags: BindingFlags): void {
      this.trace(`unbound`, flags);
      this.verifyPropertyValue('$isBound', false, 'detached');
    }
    public render(host: INode, parts: Record<string, Immutable<ITemplateDefinition>>): void {
      this.trace(`render`, host, parts);
    }
    public caching(): void {
      this.trace(`caching`);
    }

    public trace(fnName: keyof ComponentLifecycleMock, ...args: any[]): void {
      this.calls.push([fnName, ...args]);
    }

    public verifyPropertyValue(prop: string, value: any, during?: string): void {
      if (this[prop] !== value) {
        let msg = `expected ${prop} to be ${value}`;
        if (during !== undefined) {
          msg += ` during ${during}() lifecycle hook`;
        }
        msg += `, got but: ${this[prop]}`;
        this.fail(msg);
      }
    }

    public verifyCreatedCalled(): void {
      this.verifyLastCall('created');
    }
    public verifyBindingCalled(flags: BindingFlags): void {
      this.verifyLastCall(`binding`, flags);
    }
    public verifyBoundCalled(flags: BindingFlags): void {
      this.verifyLastCall(`bound`, flags);
    }
    public verifyAttachingCalled(encapsulationSource: INode, lifecycle: IAttachLifecycle): void {
      this.verifyLastCall(`attaching`, encapsulationSource, lifecycle);
    }
    public verifyAttachedCalled(): void {
      this.verifyLastCall(`attached`);
    }
    public verifyDetachingCalled(lifecycle: IDetachLifecycle): void {
      this.verifyLastCall(`detaching`, lifecycle);
    }
    public verifyDetachedCalled(): void {
      this.verifyLastCall(`detached`);
    }
    public verifyUnbindingCalled(flags: BindingFlags): void {
      this.verifyLastCall(`unbinding`, flags);
    }
    public verifyUnboundCalled(flags: BindingFlags): void {
      this.verifyLastCall(`unbound`, flags);
    }
    public verifyRenderCalled(host: INode, parts: Record<string, Immutable<ITemplateDefinition>>): void {
      this.verifyLastCall(`render`, host, parts);
    }
    public verifyCachingCalled(): void {
      this.verifyLastCall(`caching`);
    }
    public verifyLastCall(name: string, ...args: any[]): void {
      const calls = this.calls;
      if (calls.length === 0) {
        this.fail(`expected "${name}" to be the last called method, but no methods on this mock were called at all`);
      }
      const lastCall = calls.pop();
      if (lastCall[0] !== name) {
        if (calls.length === 0) {
          this.fail(`expected "${name}" to be the last called method, but the ONLY method called on this mock was "${lastCall[0]}"`);
        } else {
          const callChain = calls.map(c => `"${c[0]}"`).join('->');
          this.fail(`expected "${name}" to be the last called method, but the last method called on this mock was "${lastCall[0]}", preceded by: ${callChain}`);
        }
      }
      for (let i = 0, ii = args.length; i < ii; ++i) {
        const expected = args[i];
        const actual = lastCall[i + 1];
        if (expected !== actual) {
          this.fail(`expected argument #${i} of the call to "${name}" to be: ${expected}, but instead got: ${actual}`);
        }
      }
      if (lastCall.length > args.length + 1) {
        this.fail(`expected "${name}" to have been called with ${args.length} arguments, but it was called with ${lastCall.length - 1} arguments instead (last argument is: ${lastCall[lastCall.length - 1]})`)
      }
    }
    public verifyNoFurtherCalls(): void {
      if (this.calls.length > 0) {
        const callChain = this.calls.map(c => `"${c[0]}"`).join('->');
        this.fail(`expected no further calls, but found additional calls: ${callChain}`);
      }
    }
    private fail(message: string) {
      throw new Error(`ComponentLifecycleMock: ${message}`);
    }
  }
}

export type IComponentLifecycleMock = InstanceType<ReturnType<typeof defineComponentLifecycleMock>>;

export class MockPropertySubscriber {
  public calls: [keyof MockPropertySubscriber, ...any[]][] = [];

  public handleChange(newValue: any, previousValue: any, flags: BindingFlags): void {
    this.trace(`handleChange`, newValue, previousValue, flags);
  }

  public trace(fnName: keyof MockPropertySubscriber, ...args: any[]): void {
    this.calls.push([fnName, ...args]);
  }
}

export class MockExpression implements IExpression {
  public $kind = ExpressionKind.AccessScope;
  constructor(public value?: any) {
    this.evaluate = spy(this, 'evaluate');
  }
  evaluate() {
    return this.value;
  }
  connect = spy();
  assign = spy();
  bind = spy();
  unbind = spy();
  accept = spy();
}

export class MockBindingBehavior {
  public calls: [keyof MockBindingBehavior, ...any[]][] = [];

  public bind(flags: BindingFlags, scope: IScope, binding: IBinding, ...rest: any[]): void {
    this.trace('bind', flags, scope, binding, ...rest);
  }

  public unbind(flags: BindingFlags, scope: IScope, binding: IBinding, ...rest: any[]): void {
    this.trace('unbind', flags, scope, binding, ...rest);
  }

  public trace(fnName: keyof MockBindingBehavior, ...args: any[]): void {
    this.calls.push([fnName, ...args]);
  }
}

export class MockValueConverter {
  public calls: [keyof MockValueConverter, ...any[]][] = [];
  public fromView: MockValueConverter['$fromView'];
  public toView: MockValueConverter['$toView'];

  constructor(methods: string[]) {
    for (const method of methods) {
      this[method] = this[`$${method}`];
    }
  }

  public $fromView(value: any, ...args: any[]): any {
    this.trace('fromView', value, ...args);
    return value;
  }

  public $toView(value: any, ...args: any[]): any {
    this.trace('toView', value, ...args);
    return value;
  }

  public trace(fnName: keyof MockValueConverter, ...args: any[]): void {
    this.calls.push([fnName, ...args]);
  }
}

export interface MockServiceLocator extends IContainer {}
export class MockServiceLocator {
  public calls: [keyof MockServiceLocator, ...any[]][] = [];

  constructor(public registrations: Map<any, any>) {}

  public get(key: any): any {
    this.trace('get', key);
    return this.registrations.get(key);
  }

  public trace(fnName: keyof MockServiceLocator, ...args: any[]): void {
    this.calls.push([fnName, ...args]);
  }
}

export class MockTracingExpression {
  public $kind: ExpressionKind = ExpressionKind.HasBind | ExpressionKind.HasUnbind;
  public calls: [keyof MockTracingExpression, ...any[]][] = [];

  constructor(public inner: any) {}

  public evaluate(...args: any[]): any {
    this.trace('evaluate', ...args);
    return this.inner.evaluate(...args);
  }

  public assign(...args: any[]): any {
    this.trace('assign', ...args);
    return this.inner.assign(...args);
  }

  public connect(...args: any[]): any {
    this.trace('connect', ...args);
    this.inner.connect(...args);
  }

  public bind(...args: any[]): any {
    this.trace('bind', ...args);
    if (this.inner.bind) {
      this.inner.bind(...args);
    }
  }

  public unbind(...args: any[]): any {
    this.trace('unbind', ...args);
    if (this.inner.unbind) {
      this.inner.unbind(...args);
    }
  }

  public accept(...args: any[]): any {
    this.trace('accept', ...args);
    this.inner.accept(...args);
  }

  public trace(fnName: keyof MockTracingExpression, ...args: any[]): void {
    this.calls.push([fnName, ...args]);
  }
}

export interface MockSignaler extends ISignaler {}
export class MockSignaler {
  public calls: [keyof MockSignaler, ...any[]][] = [];

  public addSignalListener(...args: any[]): void {
    this.trace('addSignalListener', ...args);
  }

  public removeSignalListener(...args: any[]): void {
    this.trace('removeSignalListener', ...args);
  }

  public trace(fnName: keyof MockSignaler, ...args: any[]): void {
    this.calls.push([fnName, ...args]);
  }
}
