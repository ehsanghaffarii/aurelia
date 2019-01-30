import { DI, IContainer, InterfaceSymbol, IResolver, Primitive, Registration, Reporter } from '@aurelia/kernel';
import { LifecycleFlags } from '../flags';
import { ILifecycle } from '../lifecycle';
import {
  AccessorOrObserver,
  CollectionKind,
  CollectionObserver,
  IBindingContext,
  IBindingTargetAccessor,
  IBindingTargetObserver,
  ICollectionObserver,
  IObservable,
  IObservedArray,
  IObservedMap,
  IObservedSet
} from '../observation';
import { getArrayObserver } from './array-observer';
import { createComputedObserver } from './computed-observer';
import { IDirtyChecker } from './dirty-checker';
import { getMapObserver } from './map-observer';
import { PrimitiveObserver } from './primitive-observer';
import { PropertyAccessor } from './property-accessor';
import { ProxyObserver } from './proxy-observer';
import { getSetObserver } from './set-observer';
import { SetterObserver } from './setter-observer';

const toStringTag = Object.prototype.toString;

export interface IObjectObservationAdapter {
  getObserver(flags: LifecycleFlags, object: unknown, propertyName: string, descriptor: PropertyDescriptor): IBindingTargetObserver;
}

export interface IObserverLocator {
  getObserver(flags: LifecycleFlags, obj: IObservable|IBindingContext, propertyName: string): AccessorOrObserver;
  getAccessor(flags: LifecycleFlags, obj: IObservable, propertyName: string): IBindingTargetAccessor;
  addAdapter(adapter: IObjectObservationAdapter): void;
  getArrayObserver(flags: LifecycleFlags, observedArray: unknown[]): ICollectionObserver<CollectionKind.array>;
  getMapObserver(flags: LifecycleFlags, observedMap: Map<unknown, unknown>): ICollectionObserver<CollectionKind.map>;
  getSetObserver(flags: LifecycleFlags, observedSet: Set<unknown>): ICollectionObserver<CollectionKind.set>;
}

export const IObserverLocator = DI.createInterface<IObserverLocator>('IObserverLocator').noDefault();

export interface ITargetObserverLocator {
  getObserver(flags: LifecycleFlags, lifecycle: ILifecycle, observerLocator: IObserverLocator, obj: unknown, propertyName: string): IBindingTargetAccessor | IBindingTargetObserver;
  overridesAccessor(flags: LifecycleFlags, obj: unknown, propertyName: string): boolean;
  handles(flags: LifecycleFlags, obj: unknown): boolean;
}
export const ITargetObserverLocator = DI.createInterface<ITargetObserverLocator>('ITargetObserverLocator').noDefault();

export interface ITargetAccessorLocator {
  getAccessor(flags: LifecycleFlags, lifecycle: ILifecycle, obj: unknown, propertyName: string): IBindingTargetAccessor;
  handles(flags: LifecycleFlags, obj: unknown): boolean;
}
export const ITargetAccessorLocator = DI.createInterface<ITargetAccessorLocator>('ITargetAccessorLocator').noDefault();

function getPropertyDescriptor(subject: object, name: string): PropertyDescriptor {
  let pd = Object.getOwnPropertyDescriptor(subject, name);
  let proto = Object.getPrototypeOf(subject);

  while (pd === undefined && proto !== null) {
    pd = Object.getOwnPropertyDescriptor(proto, name);
    proto = Object.getPrototypeOf(proto);
  }

  return pd;
}

/** @internal */
export class ObserverLocator implements IObserverLocator {
  public static readonly inject: ReadonlyArray<InterfaceSymbol> = [ILifecycle, IDirtyChecker, ITargetObserverLocator, ITargetAccessorLocator];

  private readonly adapters: IObjectObservationAdapter[];
  private readonly dirtyChecker: IDirtyChecker;
  private readonly lifecycle: ILifecycle;
  private readonly targetObserverLocator: ITargetObserverLocator;
  private readonly targetAccessorLocator: ITargetAccessorLocator;

  constructor(
    lifecycle: ILifecycle,
    dirtyChecker: IDirtyChecker,
    targetObserverLocator: ITargetObserverLocator,
    targetAccessorLocator: ITargetAccessorLocator
  ) {
    this.adapters = [];
    this.dirtyChecker = dirtyChecker;
    this.lifecycle = lifecycle;
    this.targetObserverLocator = targetObserverLocator;
    this.targetAccessorLocator = targetAccessorLocator;
  }

  public static register(container: IContainer): IResolver<IObserverLocator> {
    return Registration.singleton(IObserverLocator, this).register(container);
  }

  public getObserver(flags: LifecycleFlags, obj: IObservable|IBindingContext, propertyName: string): AccessorOrObserver {
    if (flags & LifecycleFlags.proxyStrategy && typeof obj === 'object') {
      return ProxyObserver.getOrCreate(obj, propertyName) as unknown as AccessorOrObserver; // TODO: fix typings (and ensure proper contracts ofc)
    }
    if (isBindingContext(obj)) {
      return obj.getObservers(flags).getOrCreate(flags, obj, propertyName);
    }
    let observersLookup = obj.$observers;
    let observer: AccessorOrObserver & { doNotCache?: boolean };

    if (observersLookup && propertyName in observersLookup) {
      return observersLookup[propertyName];
    }

    observer = this.createPropertyObserver(flags, obj, propertyName);

    if (!observer.doNotCache) {
      if (observersLookup === undefined) {
        observersLookup = this.getOrCreateObserversLookup(obj);
      }

      observersLookup[propertyName] = observer;
    }

    return observer;
  }

  public addAdapter(adapter: IObjectObservationAdapter): void {
    this.adapters.push(adapter);
  }

  public getAccessor(flags: LifecycleFlags, obj: IObservable, propertyName: string): IBindingTargetAccessor {
    if (this.targetAccessorLocator.handles(flags, obj)) {
      if (this.targetObserverLocator.overridesAccessor(flags, obj, propertyName)) {
        return this.getObserver(flags, obj, propertyName);
      }
      return this.targetAccessorLocator.getAccessor(flags, this.lifecycle, obj, propertyName);
    }

    if (flags & LifecycleFlags.proxyStrategy) {
      return ProxyObserver.getOrCreate(obj, propertyName) as unknown as AccessorOrObserver;
    }
    return new PropertyAccessor(obj, propertyName);
  }

  public getArrayObserver(flags: LifecycleFlags, observedArray: IObservedArray): ICollectionObserver<CollectionKind.array> {
    return getArrayObserver(flags, this.lifecycle, observedArray);
  }

  public getMapObserver(flags: LifecycleFlags, observedMap: IObservedMap): ICollectionObserver<CollectionKind.map>  {
    return getMapObserver(flags, this.lifecycle, observedMap);
  }

  public getSetObserver(flags: LifecycleFlags, observedSet: IObservedSet): ICollectionObserver<CollectionKind.set>  {
    return getSetObserver(flags, this.lifecycle, observedSet);
  }

  private getOrCreateObserversLookup(obj: IObservable): Record<string, AccessorOrObserver | IBindingTargetObserver> {
    return obj.$observers || this.createObserversLookup(obj);
  }

  private createObserversLookup(obj: IObservable): Record<string, IBindingTargetObserver> {
    const value: Record<string, IBindingTargetObserver> = {};
    if (!Reflect.defineProperty(obj, '$observers', {
      enumerable: false,
      configurable: false,
      writable: false,
      value: value
    })) {
      Reporter.write(0, obj);
    }
    return value;
  }

  private getAdapterObserver(flags: LifecycleFlags, obj: IObservable, propertyName: string, descriptor: PropertyDescriptor): IBindingTargetObserver | null {
    for (let i = 0, ii = this.adapters.length; i < ii; i++) {
      const adapter = this.adapters[i];
      const observer = adapter.getObserver(flags, obj, propertyName, descriptor);
      if (observer) {
        return observer;
      }
    }
    return null;
  }

  private createPropertyObserver(flags: LifecycleFlags, obj: IObservable, propertyName: string): AccessorOrObserver {
    if (!(obj instanceof Object)) {
      return new PrimitiveObserver(obj as unknown as Primitive, propertyName) as IBindingTargetAccessor;
    }

    let isNode = false;
    if (this.targetObserverLocator.handles(flags, obj)) {
      const observer = this.targetObserverLocator.getObserver(flags, this.lifecycle, this, obj, propertyName);
      if (observer !== null) {
        return observer;
      }
      if (observer !== null) {
        return observer;
      }
      isNode = true;
    }

    const tag = toStringTag.call(obj);
    switch (tag) {
      case '[object Array]':
        if (propertyName === 'length') {
          return this.getArrayObserver(flags, obj as IObservedArray).getLengthObserver(flags);
        }
        return this.dirtyChecker.createProperty(obj, propertyName);
      case '[object Map]':
        if (propertyName === 'size') {
          return this.getMapObserver(flags, obj as IObservedMap).getLengthObserver(flags);
        }
        return this.dirtyChecker.createProperty(obj, propertyName);
      case '[object Set]':
        if (propertyName === 'size') {
          return this.getSetObserver(flags, obj as IObservedSet).getLengthObserver(flags);
        }
        return this.dirtyChecker.createProperty(obj, propertyName);
    }

    const descriptor = getPropertyDescriptor(obj, propertyName) as PropertyDescriptor & {
      get: PropertyDescriptor['get'] & { getObserver(obj: IObservable): IBindingTargetObserver };
    };

    if (descriptor && (descriptor.get || descriptor.set)) {
      if (descriptor.get && descriptor.get.getObserver) {
        return descriptor.get.getObserver(obj);
      }

      // attempt to use an adapter before resorting to dirty checking.
      const adapterObserver = this.getAdapterObserver(flags, obj, propertyName, descriptor);
      if (adapterObserver) {
        return adapterObserver;
      }
      if (isNode) {
        // TODO: use MutationObserver
        return this.dirtyChecker.createProperty(obj, propertyName);
      }

      return createComputedObserver(flags, this, this.dirtyChecker, this.lifecycle, obj, propertyName, descriptor);
    }
    return new SetterObserver(flags, obj, propertyName);
  }
}

type RepeatableCollection = IObservedMap | IObservedSet | IObservedArray | null | undefined | number;

export function getCollectionObserver(flags: LifecycleFlags, lifecycle: ILifecycle, collection: RepeatableCollection): CollectionObserver {
  // If the collection is wrapped by a proxy then `$observer` will return the proxy observer instead of the collection observer, which is not what we want
  // when we ask for getCollectionObserver
  const rawCollection = collection instanceof Object ? ProxyObserver.getRawIfProxy(collection) : collection;
  switch (toStringTag.call(collection)) {
    case '[object Array]':
      return getArrayObserver(flags, lifecycle, rawCollection as IObservedArray);
    case '[object Map]':
      return getMapObserver(flags, lifecycle, rawCollection as IObservedMap);
    case '[object Set]':
      return getSetObserver(flags, lifecycle, rawCollection as IObservedSet);
  }
  return null;
}

function isBindingContext(obj: unknown): obj is IBindingContext {
  return (obj as IBindingContext).$synthetic === true;
}
