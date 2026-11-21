#!/usr/bin/env python3
"""Deterministic, dependency-free Xcode project writer. Run from any directory."""
from pathlib import Path
import hashlib
import json
import plistlib

ROOT = Path(__file__).resolve().parents[1]
OBJECTS = {}
def uid(key): return hashlib.sha256(key.encode()).hexdigest()[:24].upper()
def add(key, isa, **fields):
    value = uid(key)
    OBJECTS[value] = dict(isa=isa, **fields)
    return value

def configs(key, settings):
    ids = []
    for name in ('Debug', 'Release'):
        s = dict(settings)
        if key == 'project':
            s.update(SWIFT_OPTIMIZATION_LEVEL='-Onone' if name == 'Debug' else '-O', DEBUG_INFORMATION_FORMAT='dwarf' if name == 'Debug' else 'dwarf-with-dsym', ENABLE_TESTABILITY='YES' if name == 'Debug' else 'NO')
            if name == 'Debug': s['SWIFT_ACTIVE_COMPILATION_CONDITIONS'] = 'DEBUG $(inherited)'
        ids.append(add(f'{key}.{name}', 'XCBuildConfiguration', buildSettings=s, name=name))
    return add(key + '.configlist', 'XCConfigurationList', buildConfigurations=ids, defaultConfigurationIsVisible='0', defaultConfigurationName='Release')

sources = sorted((ROOT/'Manadj').glob('*.swift'))
resources = sorted((ROOT/'Manadj/Resources').glob('*.ttf')) + [ROOT/'Manadj/Resources/UBUNTU_FONT_LICENCE.txt', ROOT/'Manadj/Resources/Assets.xcassets']
resources += sorted((ROOT/'Manadj/Resources').glob('synthetic-*'))
resources += sorted((ROOT/'Manadj/Resources').glob('lan-fixture.json'))
source_refs, source_builds, resource_refs, resource_builds = [], [], [], []
for path in sources + resources:
    ref = add(str(path.relative_to(ROOT)), 'PBXFileReference', lastKnownFileType=('sourcecode.swift' if path.suffix == '.swift' else 'folder.assetcatalog' if path.suffix == '.xcassets' else 'file'), path=str(path.relative_to(ROOT)), sourceTree='<group>')
    build = add('build.'+str(path.relative_to(ROOT)), 'PBXBuildFile', fileRef=ref)
    (source_refs if path in sources else resource_refs).append(ref)
    (source_builds if path in sources else resource_builds).append(build)
plist = add('plist', 'PBXFileReference', lastKnownFileType='text.plist.xml', path='Manadj/Info.plist', sourceTree='<group>')
packages = []
products = []
for name in ('ManadjCore', 'ManadjAudio'):
    package = add('package.'+name, 'XCLocalSwiftPackageReference', relativePath='Packages/'+name)
    packages.append(package)
    products.append(add('product.'+name, 'XCSwiftPackageProductDependency', package=package, productName=name))
frameworks = [add('link.'+name, 'PBXBuildFile', productRef=product) for name, product in zip(('ManadjCore', 'ManadjAudio'), products)]
product = add('app', 'PBXFileReference', explicitFileType='wrapper.application', includeInIndex='0', path='manaDJ.app', sourceTree='BUILT_PRODUCTS_DIR')
app_settings = dict(PRODUCT_BUNDLE_IDENTIFIER='dev.manadj.ios', PRODUCT_NAME='manaDJ', PRODUCT_MODULE_NAME='Manadj', INFOPLIST_FILE='Manadj/Info.plist', ASSETCATALOG_COMPILER_APPICON_NAME='AppIcon', TARGETED_DEVICE_FAMILY='1,2', CODE_SIGN_STYLE='Automatic', CURRENT_PROJECT_VERSION='1', MARKETING_VERSION='0.1.0', LD_RUNPATH_SEARCH_PATHS=['$(inherited)', '@executable_path/Frameworks'])
app = add('target.app', 'PBXNativeTarget', buildConfigurationList=configs('app', app_settings), buildPhases=[add('app.sources','PBXSourcesBuildPhase',buildActionMask='2147483647',files=source_builds,runOnlyForDeploymentPostprocessing='0'),add('app.frameworks','PBXFrameworksBuildPhase',buildActionMask='2147483647',files=frameworks,runOnlyForDeploymentPostprocessing='0'),add('app.resources','PBXResourcesBuildPhase',buildActionMask='2147483647',files=resource_builds,runOnlyForDeploymentPostprocessing='0')], buildRules=[],dependencies=[],name='Manadj',packageProductDependencies=products,productName='manaDJ',productReference=product,productType='com.apple.product-type.application')

targets, test_refs, test_products = [app], [], []
for name, kind in [('ManadjTests','unit-test'), ('ManadjUITests','ui-testing')]:
    refs, builds = [], []
    for path in sorted((ROOT/name).glob('*.swift')):
        ref=add(str(path.relative_to(ROOT)), 'PBXFileReference', lastKnownFileType='sourcecode.swift',path=str(path.relative_to(ROOT)),sourceTree='<group>')
        refs.append(ref); builds.append(add('build.'+str(path.relative_to(ROOT)),'PBXBuildFile',fileRef=ref))
    test_refs.extend(refs)
    prod=add(name+'.product','PBXFileReference',explicitFileType='wrapper.cfbundle',includeInIndex='0',path=name+'.xctest',sourceTree='BUILT_PRODUCTS_DIR'); test_products.append(prod)
    settings=dict(PRODUCT_BUNDLE_IDENTIFIER='dev.manadj.ios.'+name, PRODUCT_NAME='$(TARGET_NAME)', GENERATE_INFOPLIST_FILE='YES',CODE_SIGN_STYLE='Automatic',TARGETED_DEVICE_FAMILY='1,2')
    if kind=='unit-test': settings.update(TEST_HOST='$(BUILT_PRODUCTS_DIR)/manaDJ.app/manaDJ',BUNDLE_LOADER='$(TEST_HOST)')
    else: settings['TEST_TARGET_NAME']='Manadj'
    dep=add(name+'.dependency','PBXTargetDependency',target=app)
    links = [add(name+'.link.'+str(n),'PBXBuildFile',productRef=p) for n,p in enumerate(products)] if kind=='unit-test' else []
    target=add('target.'+name,'PBXNativeTarget',buildConfigurationList=configs(name,settings),buildPhases=[add(name+'.sources','PBXSourcesBuildPhase',buildActionMask='2147483647',files=builds,runOnlyForDeploymentPostprocessing='0'),add(name+'.frameworks','PBXFrameworksBuildPhase',buildActionMask='2147483647',files=links,runOnlyForDeploymentPostprocessing='0')],buildRules=[],dependencies=[dep],name=name,productName=name,productReference=prod,productType='com.apple.product-type.bundle.'+kind,packageProductDependencies=products if kind=='unit-test' else [])
    targets.append(target)
product_group=add('products','PBXGroup',children=[product]+test_products,name='Products',sourceTree='<group>')
group=add('main','PBXGroup',children=source_refs+resource_refs+[plist]+test_refs+[product_group],sourceTree='<group>')
project=add('project','PBXProject',attributes=dict(BuildIndependentTargetsInParallel='YES',LastUpgradeCheck='1600',TargetAttributes={app:dict(CreatedOnToolsVersion='16.0')}),buildConfigurationList=configs('project',dict(CLANG_CXX_LANGUAGE_STANDARD='c++17',CLANG_ENABLE_MODULES='YES',IPHONEOS_DEPLOYMENT_TARGET='17.0',SDKROOT='iphoneos',SWIFT_VERSION='6.0',SUPPORTED_PLATFORMS='iphoneos iphonesimulator',ENABLE_USER_SCRIPT_SANDBOXING='YES')),compatibilityVersion='Xcode 14.0',developmentRegion='en',hasScannedForEncodings='0',knownRegions=['en','Base'],mainGroup=group,packageReferences=packages,productRefGroup=product_group,projectDirPath='',projectRoot='',targets=targets)

def text(value, indent=0):
    if isinstance(value, dict):
        return '{\n' + ''.join('\t'*(indent+1)+json.dumps(str(k))+ ' = '+text(v,indent+1)+';\n' for k,v in value.items()) + '\t'*indent+'}'
    if isinstance(value,list): return '( '+', '.join(text(v,indent) for v in value)+' )'
    return json.dumps(str(value))
path=ROOT/'Manadj.xcodeproj'; path.mkdir(exist_ok=True)
(path/'project.pbxproj').write_text('// !$*UTF8*$!\n'+text(dict(archiveVersion='1',classes={},objectVersion='56',objects=OBJECTS,rootObject=project))+'\n')
scheme=path/'xcshareddata/xcschemes'; scheme.mkdir(parents=True,exist_ok=True)
def reference(target, name, product): return f'<BuildableReference BuildableIdentifier="primary" BlueprintIdentifier="{target}" BuildableName="{product}" BlueprintName="{name}" ReferencedContainer="container:Manadj.xcodeproj"/>'
appref=reference(app,'Manadj','manaDJ.app')
tests=''.join('<TestableReference skipped="NO">'+reference(t,n,n+'.xctest')+'</TestableReference>' for t,n in zip(targets[1:],('ManadjTests','ManadjUITests')))
(scheme/'Manadj.xcscheme').write_text(f'''<?xml version="1.0" encoding="UTF-8"?>
<Scheme LastUpgradeVersion="1600" version="1.3">
<BuildAction parallelizeBuildables="YES" buildImplicitDependencies="YES"><BuildActionEntries><BuildActionEntry buildForTesting="YES" buildForRunning="YES" buildForProfiling="YES" buildForArchiving="YES" buildForAnalyzing="YES">{appref}</BuildActionEntry></BuildActionEntries></BuildAction>
<TestAction buildConfiguration="Debug" selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier="Xcode.IDEFoundation.Launcher.LLDB" shouldUseLaunchSchemeArgsEnv="YES"><Testables>{tests}</Testables></TestAction>
<LaunchAction buildConfiguration="Debug" selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier="Xcode.IDEFoundation.Launcher.LLDB" launchStyle="0" useCustomWorkingDirectory="NO" ignoresPersistentStateOnLaunch="NO" debugServiceExtension="internal" allowLocationSimulation="YES"><BuildableProductRunnable runnableDebuggingMode="0">{appref}</BuildableProductRunnable></LaunchAction>
<ProfileAction buildConfiguration="Release" shouldUseLaunchSchemeArgsEnv="YES" savedToolIdentifier="" useCustomWorkingDirectory="NO" debugServiceExtension="internal"><BuildableProductRunnable runnableDebuggingMode="0">{appref}</BuildableProductRunnable></ProfileAction>
<AnalyzeAction buildConfiguration="Debug"/><ArchiveAction buildConfiguration="Release" revealArchiveInOrganizer="YES"/>
</Scheme>
''')
print('Generated',path)
